//! Невеликий HTTP/1.1-сервер на std::net: роздає GUI та JSON API.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use crate::blockchain::Blockchain;
use crate::json;
use crate::storage::Storage;

/// Стан вузла: ланцюг у пам'яті та (необов'язково) файл, куди він зберігається.
pub struct Node {
    pub chain: Blockchain,
    pub storage: Option<Storage>,
    /// Ланцюг відновлено з диска при запуску.
    pub restored: bool,
}

pub type Shared = Arc<Mutex<Node>>;

const MAX_BODY: usize = 16 * 1024;

/// Скільки вікон інтерфейсу зараз відкрито.
///
/// Кожна сторінка тримає з'єднання `/api/events`; коли вікно закривається,
/// з'єднання рветься. Так програма знає про закриття вікна незалежно від того,
/// яким процесом Chromium воно належить.
#[derive(Default)]
pub struct Windows {
    open: AtomicUsize,
    seen: AtomicBool,
}

impl Windows {
    pub fn open(&self) -> usize {
        self.open.load(Ordering::SeqCst)
    }

    /// Чи під'єднувалося хоча б одне вікно.
    pub fn seen(&self) -> bool {
        self.seen.load(Ordering::SeqCst)
    }
}

/// Файли інтерфейсу вбудовуються в бінарник під час компіляції.
const ASSETS: &[(&str, &str, &str)] = &[
    ("/", "text/html; charset=utf-8", include_str!("../frontend/index.html")),
    ("/style.css", "text/css; charset=utf-8", include_str!("../frontend/style.css")),
    ("/js/main.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/main.js")),
    ("/js/api.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/api.js")),
    ("/js/graph.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/graph.js")),
    ("/js/explainer.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/explainer.js")),
    ("/js/drawer.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/drawer.js")),
    ("/js/links.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/links.js")),
    ("/js/log.js", "text/javascript; charset=utf-8", include_str!("../frontend/js/log.js")),
    ("/favicon.svg", "image/svg+xml", include_str!("../frontend/favicon.svg")),
];

struct Request {
    method: String,
    path: String,
    query: String,
    body: String,
}

struct Response {
    status: u16,
    mime: &'static str,
    body: Vec<u8>,
}

impl Response {
    fn json(body: String) -> Self {
        Response { status: 200, mime: "application/json; charset=utf-8", body: body.into_bytes() }
    }

    fn text(status: u16, message: &str) -> Self {
        Response { status, mime: "text/plain; charset=utf-8", body: message.as_bytes().to_vec() }
    }
}

pub fn serve(listener: TcpListener, chain: Shared, windows: Arc<Windows>) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let chain = Arc::clone(&chain);
                let windows = Arc::clone(&windows);
                thread::spawn(move || {
                    if let Err(err) = handle(stream, &chain, &windows) {
                        // Браузер часто закриває зайві з'єднання сам — це не помилка.
                        if !matches!(
                            err.kind(),
                            io::ErrorKind::BrokenPipe
                                | io::ErrorKind::ConnectionReset
                                | io::ErrorKind::ConnectionAborted
                                | io::ErrorKind::UnexpectedEof
                                | io::ErrorKind::WouldBlock
                                | io::ErrorKind::TimedOut
                        ) {
                            eprintln!("помилка з'єднання: {err}");
                        }
                    }
                });
            }
            Err(err) => eprintln!("не вдалося прийняти з'єднання: {err}"),
        }
    }
}

fn handle(stream: TcpStream, chain: &Shared, windows: &Windows) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let response = match read_request(&stream) {
        Ok(None) => return Ok(()), // попереднє з'єднання браузера, закрите без запиту
        Ok(Some(request)) if request.method == "GET" && request.path == "/api/events" => {
            return stream_events(&stream, windows);
        }
        Ok(Some(request)) => route(&request, chain),
        Err(err) => Response::text(400, &err.to_string()),
    };
    write_response(&stream, &response)
}

/// Тримає відкритий потік server-sent events, доки вікно живе.
fn stream_events(mut stream: &TcpStream, windows: &Windows) -> io::Result<()> {
    stream.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\n\
          Connection: keep-alive\r\n\r\nretry: 1000\n\n",
    )?;
    windows.open.fetch_add(1, Ordering::SeqCst);
    windows.seen.store(true, Ordering::SeqCst);
    // Пінг кожну секунду: невдалий запис означає, що вікно закрито.
    let result = loop {
        if let Err(err) = stream.write_all(b": ping\n\n").and_then(|_| stream.flush()) {
            break Err(err);
        }
        thread::sleep(Duration::from_secs(1));
    };
    windows.open.fetch_sub(1, Ordering::SeqCst);
    result
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.to_string())
}

fn read_request(stream: &TcpStream) -> io::Result<Option<Request>> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().ok_or_else(|| invalid("порожній запит"))?.to_string();
    let target = parts.next().ok_or_else(|| invalid("у запиті немає шляху"))?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    let mut length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            break;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().map_err(|_| invalid("некоректний Content-Length"))?;
            }
        }
    }
    if length > MAX_BODY {
        return Err(invalid("тіло запиту завелике"));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    let body = String::from_utf8(body).map_err(|_| invalid("тіло запиту не є UTF-8"))?;

    Ok(Some(Request { method, path: path.to_string(), query: query.to_string(), body }))
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').filter_map(|pair| pair.split_once('=')).find(|(k, _)| *k == key).map(|(_, v)| v)
}

fn parse_index(raw: &str) -> Result<usize, String> {
    raw.parse().map_err(|_| format!("некоректний індекс блоку: {raw}"))
}

fn lock(node: &Shared) -> MutexGuard<'_, Node> {
    node.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn state(node: &Node) -> Response {
    let storage = node.storage.as_ref().map(Storage::display);
    Response::json(json::chain(&node.chain, storage.as_deref(), node.restored))
}

/// Виконує операцію над ланцюгом, зберігає його на диск і повертає новий стан.
fn mutate(node: &Shared, op: impl FnOnce(&mut Blockchain) -> Result<(), String>) -> Response {
    let mut node = lock(node);
    if let Err(message) = op(&mut node.chain) {
        return Response::text(400, &message);
    }
    if let Some(storage) = &node.storage {
        if let Err(err) = storage.save(&node.chain) {
            return Response::text(500, &format!("ланцюг змінено, але не збережено на диск: {err}"));
        }
    }
    state(&node)
}

fn route(req: &Request, chain: &Shared) -> Response {
    let segments: Vec<&str> = req.path.split('/').filter(|s| !s.is_empty()).collect();
    match (req.method.as_str(), segments.as_slice()) {
        ("GET", ["api", "chain"]) => state(&lock(chain)),
        ("POST", ["api", "blocks"]) => mutate(chain, |c| c.add(&req.body).map(|_| ())),
        ("POST", ["api", "blocks", index, "data"]) => {
            mutate(chain, |c| c.tamper(parse_index(index)?, &req.body))
        }
        ("POST", ["api", "blocks", index, "mine"]) => mutate(chain, |c| {
            let cascade = query_param(&req.query, "cascade") == Some("1");
            c.remine(parse_index(index)?, cascade)
        }),
        ("POST", ["api", "difficulty"]) => mutate(chain, |c| {
            let value = query_param(&req.query, "value").ok_or("немає параметра value")?;
            c.set_difficulty(value.parse().map_err(|_| "некоректна складність".to_string())?)
        }),
        ("POST", ["api", "reset"]) => mutate(chain, |c| {
            c.reset();
            Ok(())
        }),
        ("GET", _) => {
            let path = if req.path == "/index.html" { "/" } else { req.path.as_str() };
            match ASSETS.iter().find(|(p, _, _)| *p == path) {
                Some((_, mime, body)) => Response { status: 200, mime, body: body.as_bytes().to_vec() },
                None => Response::text(404, "не знайдено"),
            }
        }
        _ => Response::text(405, "метод не підтримується"),
    }
}

fn write_response(mut stream: &TcpStream, response: &Response) -> io::Result<()> {
    let reason = match response.status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\
         X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        response.status,
        reason,
        response.mime,
        response.body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(&response.body)?;
    stream.flush()
}
