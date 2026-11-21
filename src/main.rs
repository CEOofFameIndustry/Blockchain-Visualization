mod blockchain;

use std::fs;
use std::io::Cursor;
use std::process::{Child, Command, Stdio};
use std::thread;

use blockchain::Blockchain;
use tiny_http::{Header, Method, Request, Response, Server};

const FILE: &str = "chain.json";

fn main() {
    let mut chain = Blockchain::load(FILE);
    let server = Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", server.server_addr().to_ip().unwrap());
    println!("Інтерфейс: {url}");

    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(&mut chain, request);
        }
    });

    let profile = std::env::temp_dir().join(format!("kursova-chromium-{}", std::process::id()));
    match open_browser(&url, &profile.to_string_lossy()) {
        Some(mut browser) => {
            let _ = browser.wait();
            let _ = fs::remove_dir_all(&profile);
        }
        None => {
            println!("Chromium не знайдено. Відкрийте {url} у браузері. Ctrl+C: вихід.");
            loop {
                thread::park();
            }
        }
    }
}

fn open_browser(url: &str, profile: &str) -> Option<Child> {
    for name in ["chromium", "google-chrome-stable", "google-chrome", "chrome", "msedge"] {
        let browser = Command::new(name)
            .arg(format!("--app={url}"))
            .arg(format!("--user-data-dir={profile}"))
            .arg("--no-first-run")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if let Ok(browser) = browser {
            return Some(browser);
        }
    }
    None
}

fn handle(chain: &mut Blockchain, mut request: Request) {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    let url = request.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    let result = match (request.method(), parts.as_slice()) {
        (Method::Get, ["api", "chain"]) => Some(Ok(())),
        (Method::Post, ["api", "blocks"]) => Some(chain.add(&body)),
        (Method::Post, ["api", "blocks", i, "data"]) => Some(index(i).and_then(|i| chain.tamper(i, &body))),
        (Method::Post, ["api", "blocks", i, "mine"]) => Some(index(i).and_then(|i| chain.remine(i, query == "cascade=1"))),
        (Method::Post, ["api", "difficulty"]) => Some(
            query.strip_prefix("value=").and_then(|v| v.parse().ok()).ok_or("некоректна складність".to_string())
                .and_then(|d| chain.set_difficulty(d)),
        ),
        (Method::Post, ["api", "reset"]) => {
            *chain = Blockchain::demo();
            Some(Ok(()))
        }
        _ => None,
    };

    let response = match result {
        Some(Ok(())) => {
            chain.save(FILE);
            reply(200, "application/json", chain.to_json().to_string())
        }
        Some(Err(message)) => reply(400, "text/plain", message),
        None => static_file(path),
    };
    let _ = request.respond(response);
}

fn index(raw: &str) -> Result<usize, String> {
    raw.parse().map_err(|_| "некоректний номер блоку".to_string())
}

fn static_file(path: &str) -> Response<Cursor<Vec<u8>>> {
    let (mime, body) = match path {
        "/" => ("text/html", include_str!("../frontend/index.html")),
        "/style.css" => ("text/css", include_str!("../frontend/style.css")),
        "/favicon.svg" => ("image/svg+xml", include_str!("../frontend/favicon.svg")),
        "/js/main.js" => ("text/javascript", include_str!("../frontend/js/main.js")),
        "/js/graph.js" => ("text/javascript", include_str!("../frontend/js/graph.js")),
        "/js/explainer.js" => ("text/javascript", include_str!("../frontend/js/explainer.js")),
        "/js/api.js" => ("text/javascript", include_str!("../frontend/js/api.js")),
        "/js/log.js" => ("text/javascript", include_str!("../frontend/js/log.js")),
        "/js/drawer.js" => ("text/javascript", include_str!("../frontend/js/drawer.js")),
        "/js/links.js" => ("text/javascript", include_str!("../frontend/js/links.js")),
        _ => return reply(404, "text/plain", "не знайдено".into()),
    };
    reply(200, mime, body.into())
}

fn reply(status: u16, mime: &str, body: String) -> Response<Cursor<Vec<u8>>> {
    let header = Header::from_bytes("Content-Type", format!("{mime}; charset=utf-8")).unwrap();
    Response::from_string(body).with_status_code(status).with_header(header)
}
