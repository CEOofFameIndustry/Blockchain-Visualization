//! Мінімальна JSON-серіалізація стану ланцюга для GUI.

use std::fmt::Write;

use crate::blockchain::Blockchain;

pub fn string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn chain(chain: &Blockchain, storage: Option<&str>, restored: bool) -> String {
    let checks = chain.check();
    let first_invalid = checks.iter().position(|c| !c.valid());

    let mut out = String::new();
    let _ = write!(
        out,
        "{{\"storage\":{},\"restored\":{},\"difficulty\":{},\"valid\":{},\"firstInvalid\":{},\"blocks\":[",
        storage.map_or("null".to_string(), string),
        restored,
        chain.difficulty,
        first_invalid.is_none(),
        first_invalid.map_or("null".to_string(), |i| i.to_string()),
    );
    for (i, (block, check)) in chain.blocks.iter().zip(&checks).enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(
            out,
            "{{\"index\":{},\"timestamp\":{},\"data\":{},\"prevHash\":{},\"hash\":{},\"nonce\":{},\
             \"difficulty\":{},\"attempts\":{},\"mineMicros\":{},\"hashOk\":{},\"linkOk\":{},\
             \"powOk\":{},\"valid\":{},\"computedHash\":{}}}",
            block.index,
            block.timestamp,
            string(&block.data),
            string(&block.prev_hash),
            string(&block.hash),
            block.nonce,
            block.difficulty,
            block.attempts,
            block.mine_micros,
            check.hash_ok,
            check.link_ok,
            check.pow_ok,
            check.valid(),
            string(&check.computed_hash),
        );
    }
    out.push_str("]}");
    out
}

#[cfg(test)]
mod tests {
    use super::string;

    #[test]
    fn escapes_special_characters() {
        assert_eq!(string("a\"b\\c\nd\u{1}"), "\"a\\\"b\\\\c\\nd\\u0001\"");
        assert_eq!(string("Аліса → Боб"), "\"Аліса → Боб\"");
    }
}
