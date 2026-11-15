
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::blockchain::{Block, Blockchain, MAX_DIFFICULTY, MIN_DIFFICULTY};

const MAGIC: &str = "KURSOVA-CHAIN 1";

pub struct Storage {
    pub path: PathBuf,
}

impl Storage {
    pub fn new(path: PathBuf) -> Self {
        Storage { path }
    }

    /// `$XDG_DATA_HOME/kursova_rust/chain.txt`, `~/.local/share/...` або `%APPDATA%\...`.
    pub fn default_path() -> PathBuf {
        let env = |key| std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from);
        let base = env("XDG_DATA_HOME")
            .or_else(|| env("APPDATA"))
            .or_else(|| env("HOME").map(|h| h.join(".local").join("share")))
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("kursova_rust").join("chain.txt")
    }

    /// `Ok(None)` — файлу ще немає (перший запуск).
    pub fn load(&self) -> Result<Option<Blockchain>, String> {
        match fs::read_to_string(&self.path) {
            Ok(text) => decode(&text).map(Some),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(format!("не вдалося прочитати {}: {err}", self.path.display())),
        }
    }

    /// Записує атомарно: спершу тимчасовий файл, потім перейменування.
    pub fn save(&self, chain: &Blockchain) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("tmp");
        fs::write(&tmp, encode(chain))?;
        fs::rename(&tmp, &self.path)
    }

    /// Відкладає пошкоджений файл убік, щоб не втратити його.
    pub fn quarantine(&self) -> io::Result<PathBuf> {
        let bad = self.path.with_extension("bad");
        fs::rename(&self.path, &bad)?;
        Ok(bad)
    }

    pub fn display(&self) -> String {
        display_path(&self.path)
    }
}

fn display_path(path: &Path) -> String {
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if let Ok(rest) = path.strip_prefix(&home) {
            return format!("~/{}", rest.display());
        }
    }
    path.display().to_string()
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c => out.push(c),
        }
    }
    out
}

fn unescape(s: &str) -> Result<String, String> {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            other => return Err(format!("некоректне екранування: \\{}", other.map(String::from).unwrap_or_default())),
        }
    }
    Ok(out)
}

pub fn encode(chain: &Blockchain) -> String {
    let mut out = format!("{MAGIC}\ndifficulty {}\n", chain.difficulty);
    for b in &chain.blocks {
        out.push_str(&format!(
            "block {}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            b.index,
            b.timestamp,
            b.prev_hash,
            b.nonce,
            b.difficulty,
            b.hash,
            b.attempts,
            b.mine_micros,
            escape(&b.data)
        ));
    }
    out
}

pub fn decode(text: &str) -> Result<Blockchain, String> {
    let mut lines = text.lines().enumerate().filter(|(_, l)| !l.trim().is_empty());
    match lines.next() {
        Some((_, l)) if l.trim() == MAGIC => {}
        _ => return Err("файл не є збереженим ланцюгом".into()),
    }

    let mut difficulty = None;
    let mut blocks = Vec::new();
    for (n, line) in lines {
        let at = |msg: &str| format!("рядок {}: {msg}", n + 1);
        if let Some(rest) = line.strip_prefix("difficulty ") {
            let d: u32 = rest.trim().parse().map_err(|_| at("некоректна складність"))?;
            if !(MIN_DIFFICULTY..=MAX_DIFFICULTY).contains(&d) {
                return Err(at("складність поза межами"));
            }
            difficulty = Some(d);
        } else if let Some(rest) = line.strip_prefix("block ") {
            let f: Vec<&str> = rest.splitn(9, '\t').collect();
            if f.len() != 9 {
                return Err(at("очікується 9 полів блоку"));
            }
            let num = |i: usize| f[i].parse::<u64>().map_err(|_| at("некоректне число"));
            let block = Block {
                index: num(0)?,
                timestamp: num(1)?,
                prev_hash: f[2].to_string(),
                nonce: num(3)?,
                difficulty: f[4].parse().map_err(|_| at("некоректна складність блоку"))?,
                hash: f[5].to_string(),
                attempts: num(6)?,
                mine_micros: num(7)?,
                data: unescape(f[8]).map_err(|e| at(&e))?,
            };
            if block.index != blocks.len() as u64 {
                return Err(at("індекси блоків мають іти підряд від 0"));
            }
            blocks.push(block);
        } else {
            return Err(at("невідомий запис"));
        }
    }

    if blocks.is_empty() {
        return Err("у файлі немає жодного блоку".into());
    }
    Ok(Blockchain { blocks, difficulty: difficulty.ok_or("не вказано складність")? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blockchain::BlockCheck;

    #[test]
    fn roundtrip_keeps_every_field() {
        let mut chain = Blockchain::demo();
        chain.add("таб\tрядок\nслеш\\ кінець").unwrap();
        let restored = decode(&encode(&chain)).unwrap();
        assert_eq!(restored.difficulty, chain.difficulty);
        assert_eq!(restored.blocks.len(), chain.blocks.len());
        for (a, b) in restored.blocks.iter().zip(&chain.blocks) {
            assert_eq!(a.data, b.data);
            assert_eq!(a.hash, b.hash);
            assert_eq!(a.nonce, b.nonce);
            assert_eq!(a.prev_hash, b.prev_hash);
        }
        assert!(restored.check().iter().all(BlockCheck::valid));
    }

    #[test]
    fn edited_file_is_detected_by_validation() {
        let chain = Blockchain::demo();
        let text = encode(&chain).replace("Боб → Віра: 1.0", "Боб → Віра: 999");
        let restored = decode(&text).unwrap();
        assert!(!restored.check()[2].hash_ok);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode("hello").is_err());
        assert!(decode("KURSOVA-CHAIN 1\ndifficulty 3\n").is_err());
        assert!(decode("KURSOVA-CHAIN 1\ndifficulty 3\nblock 1\t2").is_err());
    }

    #[test]
    fn save_and_load_from_disk() {
        let dir = std::env::temp_dir().join(format!("kursova-test-{}", std::process::id()));
        let storage = Storage::new(dir.join("chain.txt"));
        assert!(storage.load().unwrap().is_none());
        let chain = Blockchain::demo();
        storage.save(&chain).unwrap();
        let loaded = storage.load().unwrap().unwrap();
        assert_eq!(loaded.tip().hash, chain.tip().hash);
        let _ = fs::remove_dir_all(dir);
    }
}
