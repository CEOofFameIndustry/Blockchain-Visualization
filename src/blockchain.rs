//! Модель блокчейну: блоки, майнінг (proof-of-work) і перевірка цілісності.

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::sha256;

pub const MIN_DIFFICULTY: u32 = 1;
pub const MAX_DIFFICULTY: u32 = 5;
pub const DEFAULT_DIFFICULTY: u32 = 3;
pub const MAX_DATA_CHARS: usize = 280;

/// `prev_hash` генезис-блоку.
pub const GENESIS_PREV: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone, Debug)]
pub struct Block {
    pub index: u64,
    /// Мілісекунди від Unix-епохи.
    pub timestamp: u64,
    pub data: String,
    pub prev_hash: String,
    pub nonce: u64,
    /// Складність, з якою блок було замайнено (кількість нулів на початку хешу).
    pub difficulty: u32,
    pub hash: String,
    /// Скільки хешів довелося перебрати під час майнінгу.
    pub attempts: u64,
    pub mine_micros: u64,
}

impl Block {
    fn new(index: u64, data: String, prev_hash: String, difficulty: u32, timestamp: u64) -> Self {
        let mut block = Block {
            index,
            timestamp,
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

    /// Хеш заголовка блоку з поточним nonce.
    pub fn compute_hash(&self) -> String {
        let header = format!(
            "{}|{}|{}|{}|{}|{}",
            self.index, self.timestamp, self.prev_hash, self.difficulty, self.nonce, self.data
        );
        sha256::hex(header.as_bytes())
    }

    /// Перебирає nonce, доки хеш не почнеться з `difficulty` нулів.
    pub fn mine(&mut self) {
        let started = Instant::now();
        let mut nonce = 0u64;
        loop {
            self.nonce = nonce;
            let hash = self.compute_hash();
            if meets_difficulty(&hash, self.difficulty) {
                self.hash = hash;
                break;
            }
            nonce += 1;
        }
        self.attempts = nonce + 1;
        self.mine_micros = started.elapsed().as_micros() as u64;
    }
}

pub fn meets_difficulty(hash: &str, difficulty: u32) -> bool {
    hash.len() >= difficulty as usize && hash.bytes().take(difficulty as usize).all(|b| b == b'0')
}

/// Результат перевірки одного блоку.
#[derive(Clone, Debug, PartialEq)]
pub struct BlockCheck {
    /// Збережений хеш відповідає вмісту блоку.
    pub hash_ok: bool,
    /// `prev_hash` дорівнює хешу попереднього блоку.
    pub link_ok: bool,
    /// Хеш задовольняє складність (proof-of-work).
    pub pow_ok: bool,
    pub computed_hash: String,
}

impl BlockCheck {
    pub fn valid(&self) -> bool {
        self.hash_ok && self.link_ok && self.pow_ok
    }
}

pub struct Blockchain {
    pub blocks: Vec<Block>,
    pub difficulty: u32,
}

impl Blockchain {
    pub fn new(difficulty: u32) -> Self {
        let difficulty = difficulty.clamp(MIN_DIFFICULTY, MAX_DIFFICULTY);
        let genesis = Block::new(0, "Genesis".into(), GENESIS_PREV.into(), difficulty, now_ms());
        Blockchain { blocks: vec![genesis], difficulty }
    }

    /// Ланцюг із кількома демонстраційними транзакціями.
    pub fn demo() -> Self {
        let mut chain = Blockchain::new(DEFAULT_DIFFICULTY);
        let start = now_ms() - 4 * 60_000;
        chain.blocks[0].timestamp = start;
        chain.blocks[0].mine();
        for (i, data) in ["Аліса → Боб: 2.5", "Боб → Віра: 1.0", "Віра → Аліса: 0.4", "Гліб → Боб: 3.2"]
            .into_iter()
            .enumerate()
        {
            chain.push(data.into(), start + (i as u64 + 1) * 60_000);
        }
        chain
    }

    pub fn reset(&mut self) {
        *self = Blockchain::demo();
    }

    pub fn tip(&self) -> &Block {
        self.blocks.last().expect("ланцюг завжди містить генезис-блок")
    }

    fn push(&mut self, data: String, timestamp: u64) -> &Block {
        let tip = self.tip();
        let block = Block::new(tip.index + 1, data, tip.hash.clone(), self.difficulty, timestamp);
        self.blocks.push(block);
        self.tip()
    }

    /// Майнить і додає новий блок у кінець ланцюга.
    pub fn add(&mut self, data: &str) -> Result<&Block, String> {
        let data = clean_data(data)?;
        Ok(self.push(data, now_ms()))
    }

    /// Змінює дані блоку без перерахунку хешу — імітація атаки.
    pub fn tamper(&mut self, index: usize, data: &str) -> Result<(), String> {
        let data = clean_data(data)?;
        let block = self.blocks.get_mut(index).ok_or_else(|| format!("блоку #{index} не існує"))?;
        block.data = data;
        Ok(())
    }

    /// Перемайнює блок (за потреби — і всі наступні), прив'язуючи до попереднього.
    pub fn remine(&mut self, index: usize, cascade: bool) -> Result<(), String> {
        if index >= self.blocks.len() {
            return Err(format!("блоку #{index} не існує"));
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
        if !(MIN_DIFFICULTY..=MAX_DIFFICULTY).contains(&difficulty) {
            return Err(format!("складність має бути від {MIN_DIFFICULTY} до {MAX_DIFFICULTY}"));
        }
        self.difficulty = difficulty;
        Ok(())
    }

    /// Перевіряє кожен блок незалежно.
    pub fn check(&self) -> Vec<BlockCheck> {
        self.blocks
            .iter()
            .enumerate()
            .map(|(i, block)| {
                let computed_hash = block.compute_hash();
                let expected_prev = if i == 0 { GENESIS_PREV } else { self.blocks[i - 1].hash.as_str() };
                BlockCheck {
                    hash_ok: computed_hash == block.hash,
                    link_ok: block.prev_hash == expected_prev,
                    pow_ok: meets_difficulty(&block.hash, block.difficulty),
                    computed_hash,
                }
            })
            .collect()
    }
}

fn clean_data(data: &str) -> Result<String, String> {
    let data = data.trim();
    if data.is_empty() {
        return Err("дані блоку не можуть бути порожніми".into());
    }
    if data.chars().count() > MAX_DATA_CHARS {
        return Err(format!("дані блоку — щонайбільше {MAX_DATA_CHARS} символів"));
    }
    Ok(data.to_string())
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_valid(chain: &Blockchain) -> bool {
        chain.check().iter().all(BlockCheck::valid)
    }

    #[test]
    fn demo_chain_is_valid_and_mined() {
        let chain = Blockchain::demo();
        assert_eq!(chain.blocks.len(), 5);
        assert!(all_valid(&chain));
        assert!(chain.blocks.iter().all(|b| b.hash.starts_with("000")));
    }

    #[test]
    fn tamper_breaks_only_hash_of_that_block() {
        let mut chain = Blockchain::demo();
        chain.tamper(2, "Боб → Мелорі: 1000").unwrap();
        let checks = chain.check();
        assert!(!checks[2].hash_ok);
        assert!(checks[3].link_ok, "посилання наступного блоку ще ціле");
    }

    #[test]
    fn remine_moves_break_to_next_block_and_cascade_fixes_it() {
        let mut chain = Blockchain::demo();
        chain.tamper(2, "підробка").unwrap();
        chain.remine(2, false).unwrap();
        let checks = chain.check();
        assert!(checks[2].valid());
        assert!(!checks[3].link_ok);

        chain.remine(2, true).unwrap();
        assert!(all_valid(&chain));
    }

    #[test]
    fn rejects_bad_input() {
        let mut chain = Blockchain::demo();
        assert!(chain.add("   ").is_err());
        assert!(chain.add(&"x".repeat(MAX_DATA_CHARS + 1)).is_err());
        assert!(chain.set_difficulty(9).is_err());
        assert!(chain.tamper(99, "x").is_err());
    }

    #[test]
    fn difficulty_applies_to_new_blocks() {
        let mut chain = Blockchain::new(1);
        chain.set_difficulty(4).unwrap();
        let block = chain.add("тест").unwrap();
        assert!(block.hash.starts_with("0000"));
        assert_eq!(block.difficulty, 4);
    }
}
