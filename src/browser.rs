//! Запуск Chromium як вікна застосунку (режим --app, без вкладок і адресного рядка).

use std::env;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

const CANDIDATES: &[&str] = &[
    "chromium",
    "chromium-browser",
    "google-chrome-stable",
    "google-chrome",
    "brave-browser",
    "brave",
    "microsoft-edge-stable",
    "chrome.exe",
    "msedge.exe",
];

const ABSOLUTE: &[&str] = &[
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
];

/// Шукає Chromium: змінна CHROMIUM_PATH, потім PATH, потім типові шляхи.
pub fn find() -> Option<PathBuf> {
    if let Some(path) = env::var_os("CHROMIUM_PATH") {
        return Some(path.into());
    }
    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path) {
            for name in CANDIDATES {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    ABSOLUTE.iter().map(PathBuf::from).find(|p| p.is_file())
}

pub fn launch(url: &str) -> Result<Child, String> {
    let binary = find().ok_or("Chromium не знайдено. Встановіть chromium або задайте CHROMIUM_PATH.")?;
    // Окремий профіль: вікно стає самостійним процесом, на завершення якого можна чекати.
    let profile = env::temp_dir().join("kursova-blockchain-chromium");
    Command::new(&binary)
        .arg(format!("--app={url}"))
        .arg(format!("--user-data-dir={}", profile.display()))
        .args([
            "--window-size=1400,880",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-sync",
            "--disable-features=Translate",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("не вдалося запустити {}: {err}", binary.display()))
}
