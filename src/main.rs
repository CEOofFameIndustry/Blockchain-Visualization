//! Візуалізація роботи блокчейну.
//!
//! Rust-ядро тримає ланцюг, майнить блоки та перевіряє цілісність,
//! а Chromium (режим --app) відображає інтерфейс, отриманий з локального сервера.

mod blockchain;
mod browser;
mod json;
mod server;
mod sha256;
mod storage;

use std::net::TcpListener;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use blockchain::Blockchain;
use server::{Node, Windows};
use storage::Storage;

/// Скільки чекати першого вікна після запуску Chromium.
const FIRST_WINDOW_TIMEOUT: Duration = Duration::from_secs(30);
/// Пауза без жодного вікна, після якої програма завершується (переживає перезавантаження сторінки).
const IDLE_GRACE: Duration = Duration::from_secs(3);

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let no_browser = args.iter().any(|a| a == "--no-browser");
    let port: u16 = args
        .iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    let data_path = args.iter().position(|a| a == "--data").and_then(|i| args.get(i + 1));
    let ephemeral = args.iter().any(|a| a == "--no-save");

    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("не вдалося відкрити порт {port}: {err}");
            return ExitCode::FAILURE;
        }
    };
    let url = match listener.local_addr() {
        Ok(addr) => format!("http://{addr}/"),
        Err(err) => {
            eprintln!("не вдалося визначити адресу: {err}");
            return ExitCode::FAILURE;
        }
    };

    let node = Arc::new(Mutex::new(open_node(data_path.map(Into::into), ephemeral)));
    let windows = Arc::new(Windows::default());
    let server_windows = Arc::clone(&windows);
    thread::spawn(move || server::serve(listener, node, server_windows));
    println!("Інтерфейс: {url}");

    if no_browser {
        println!("Режим без вікна. Ctrl+C — вихід.");
        loop {
            thread::park();
        }
    }

    match browser::launch(&url) {
        Ok(mut child) => {
            // Не покладаємося на процес: Chromium може передати вікно вже запущеному
            // екземпляру або перезапуститися. Стежимо за самими вікнами.
            thread::spawn(move || {
                let _ = child.wait();
            });
            wait_for_windows_closed(&windows);
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{err}");
            eprintln!("Відкрийте {url} у браузері вручну. Ctrl+C — вихід.");
            loop {
                thread::park();
            }
        }
    }
}

fn wait_for_windows_closed(windows: &Windows) {
    let started = Instant::now();
    let mut idle_since: Option<Instant> = None;
    loop {
        thread::sleep(Duration::from_millis(250));
        if windows.open() > 0 {
            idle_since = None;
            continue;
        }
        if !windows.seen() {
            if started.elapsed() > FIRST_WINDOW_TIMEOUT {
                eprintln!("Вікно інтерфейсу так і не під'єдналося. Завершення.");
                return;
            }
            continue;
        }
        if idle_since.get_or_insert_with(Instant::now).elapsed() >= IDLE_GRACE {
            return;
        }
    }
}

/// Відновлює ланцюг із диска або створює новий (і одразу зберігає).
fn open_node(path: Option<std::path::PathBuf>, ephemeral: bool) -> Node {
    if ephemeral {
        println!("Ланцюг не зберігається (--no-save).");
        return Node { chain: Blockchain::demo(), storage: None, restored: false };
    }
    let storage = Storage::new(path.unwrap_or_else(Storage::default_path));
    let (chain, restored) = match storage.load() {
        Ok(Some(chain)) => {
            println!("Ланцюг відновлено: {} блоків із {}", chain.blocks.len(), storage.display());
            (chain, true)
        }
        Ok(None) => {
            println!("Створено новий ланцюг: {}", storage.display());
            (Blockchain::demo(), false)
        }
        Err(err) => {
            eprintln!("Збережений ланцюг пошкоджено ({err}).");
            match storage.quarantine() {
                Ok(bad) => eprintln!("Файл відкладено в {}; створено новий ланцюг.", bad.display()),
                Err(e) => eprintln!("Не вдалося відкласти файл: {e}"),
            }
            (Blockchain::demo(), false)
        }
    };
    if !restored {
        if let Err(err) = storage.save(&chain) {
            eprintln!("Не вдалося зберегти ланцюг: {err}");
        }
    }
    Node { chain, storage: Some(storage), restored }
}
