use std::fs;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const GENESIS_PREV: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub index: u64,
    pub timestamp: u64,
    pub data: String,
    pub prev_hash: String,
    pub nonce: u64,
    pub difficulty: u32,
    pub hash: String,
    pub attempts: u64,
    pub mine_micros: u64,
}

impl Block {
    fn new(index: u64, data: String, prev_hash: String, difficulty: u32) -> Block {
        let mut block = Block {
            index,
            timestamp: now_ms(),
            data,
            prev_hash,
            nonce: 0,
            difficulty,
            hash: String::new(),
            attempts: 0,
            mine_micros: 0,
        };
        block.mine();
        block
    }

    pub fn compute_hash(&self) -> String {
        let header = format!(
            "{}|{}|{}|{}|{}|{}",
            self.index, self.timestamp, self.prev_hash, self.difficulty, self.nonce, self.data
        );
        format!("{:x}", Sha256::digest(header))
    }

    pub fn mine(&mut self) {
        let started = Instant::now();
        let zeros = "0".repeat(self.difficulty as usize);
        self.nonce = 0;
        loop {
            self.hash = self.compute_hash();
            if self.hash.starts_with(&zeros) {
                break;
            }
            self.nonce += 1;
        }
        self.attempts = self.nonce + 1;
        self.mine_micros = started.elapsed().as_micros() as u64;
    }
}

#[derive(Serialize, Deserialize)]
pub struct Blockchain {
    pub blocks: Vec<Block>,
    pub difficulty: u32,
}

impl Blockchain {
    pub fn demo() -> Blockchain {
        let mut chain = Blockchain { blocks: vec![Block::new(0, "Genesis".into(), GENESIS_PREV.into(), 3)], difficulty: 3 };
        for data in ["Аліса → Боб: 2.5", "Боб → Віра: 1.0", "Віра → Аліса: 0.4", "Гліб → Боб: 3.2"] {
            chain.add(data).unwrap();
        }
        chain
    }

    pub fn load(path: &str) -> Blockchain {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|err| {
                eprintln!("Файл {path} пошкоджено ({err}), створено новий ланцюг.");
                Blockchain::demo()
            }),
            Err(_) => Blockchain::demo(),
        }
    }

    pub fn save(&self, path: &str) {
        let text = serde_json::to_string_pretty(self).unwrap();
        if let Err(err) = fs::write(path, text) {
            eprintln!("Не вдалося зберегти ланцюг у {path}: {err}");
        }
    }

    pub fn add(&mut self, data: &str) -> Result<(), String> {
        let data = check_data(data)?;
        let last = self.blocks.last().unwrap();
        let block = Block::new(last.index + 1, data, last.hash.clone(), self.difficulty);
        self.blocks.push(block);
        Ok(())
    }

    pub fn tamper(&mut self, index: usize, data: &str) -> Result<(), String> {
        let data = check_data(data)?;
        let block = self.blocks.get_mut(index).ok_or("такого блоку немає")?;
        block.data = data;
        Ok(())
    }

    pub fn remine(&mut self, index: usize, cascade: bool) -> Result<(), String> {
        if index >= self.blocks.len() {
            return Err("такого блоку немає".into());
        }
        let end = if cascade { self.blocks.len() } else { index + 1 };
        for i in index..end {
            let prev = if i == 0 { GENESIS_PREV.to_string() } else { self.blocks[i - 1].hash.clone() };
            let block = &mut self.blocks[i];
            block.prev_hash = prev;
            block.difficulty = self.difficulty;
            block.mine();
        }
        Ok(())
    }

    pub fn set_difficulty(&mut self, difficulty: u32) -> Result<(), String> {
        if !(1..=5).contains(&difficulty) {
            return Err("складність має бути від 1 до 5".into());
        }
        self.difficulty = difficulty;
        Ok(())
    }

    pub fn check(&self, i: usize) -> (bool, bool, bool) {
        let block = &self.blocks[i];
        let prev = if i == 0 { GENESIS_PREV } else { &self.blocks[i - 1].hash };
        let hash_ok = block.compute_hash() == block.hash;
        let link_ok = block.prev_hash == prev;
        let pow_ok = block.hash.starts_with(&"0".repeat(block.difficulty as usize));
        (hash_ok, link_ok, pow_ok)
    }

    pub fn to_json(&self) -> Value {
        let mut blocks = Vec::new();
        let mut first_invalid = None;
        for (i, block) in self.blocks.iter().enumerate() {
            let (hash_ok, link_ok, pow_ok) = self.check(i);
            let valid = hash_ok && link_ok && pow_ok;
            if !valid && first_invalid.is_none() {
                first_invalid = Some(i);
            }
            let mut item = serde_json::to_value(block).unwrap();
            item["hashOk"] = json!(hash_ok);
            item["linkOk"] = json!(link_ok);
            item["powOk"] = json!(pow_ok);
            item["valid"] = json!(valid);
            item["computedHash"] = json!(block.compute_hash());
            blocks.push(item);
        }
        json!({
            "difficulty": self.difficulty,
            "valid": first_invalid.is_none(),
            "firstInvalid": first_invalid,
            "blocks": blocks,
        })
    }
}

fn check_data(data: &str) -> Result<String, String> {
    let data = data.trim();
    if data.is_empty() {
        return Err("дані блоку не можуть бути порожніми".into());
    }
    if data.chars().count() > 280 {
        return Err("дані блоку: щонайбільше 280 символів".into());
    }
    Ok(data.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_valid(chain: &Blockchain) -> bool {
        (0..chain.blocks.len()).all(|i| chain.check(i) == (true, true, true))
    }

    #[test]
    fn demo_chain_is_valid() {
        let chain = Blockchain::demo();
        assert_eq!(chain.blocks.len(), 5);
        assert!(all_valid(&chain));
    }

    #[test]
    fn tamper_is_detected() {
        let mut chain = Blockchain::demo();
        chain.tamper(2, "підробка").unwrap();
        assert_eq!(chain.check(2), (false, true, true));
    }

    #[test]
    fn remine_breaks_next_link_and_cascade_fixes_it() {
        let mut chain = Blockchain::demo();
        chain.tamper(2, "підробка").unwrap();
        chain.remine(2, false).unwrap();
        assert_eq!(chain.check(3), (true, false, true));
        chain.remine(2, true).unwrap();
        assert!(all_valid(&chain));
    }

    #[test]
    fn rejects_bad_input() {
        let mut chain = Blockchain::demo();
        assert!(chain.add("   ").is_err());
        assert!(chain.add(&"x".repeat(281)).is_err());
        assert!(chain.set_difficulty(9).is_err());
        assert!(chain.tamper(99, "x").is_err());
    }

    #[test]
    fn save_and_load() {
        let path = std::env::temp_dir().join("kursova-test-chain.json");
        let path = path.to_str().unwrap();
        let chain = Blockchain::demo();
        chain.save(path);
        let loaded = Blockchain::load(path);
        assert_eq!(loaded.blocks.last().unwrap().hash, chain.blocks.last().unwrap().hash);
        let _ = fs::remove_file(path);
    }
}
