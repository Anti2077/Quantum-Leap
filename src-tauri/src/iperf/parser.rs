use crate::model::{SpeedSampleEvent, TransferDirection};
use serde_json::Value;

pub(super) fn add_tcp_latency_jitter(
    sample: &mut SpeedSampleEvent,
    previous_latency_ms: &mut Option<f64>,
) {
    let Some(latency_ms) = sample.latency_ms else {
        return;
    };
    if sample.jitter_ms.is_none() {
        sample.jitter_ms = previous_latency_ms.map(|previous| (latency_ms - previous).abs());
    }
    *previous_latency_ms = Some(latency_ms);
}

pub(super) fn parse_sample(line: &str, direction: TransferDirection) -> Option<SpeedSampleEvent> {
    let root = serde_json::from_str::<Value>(line).ok()?;
    if root
        .get("event")
        .and_then(Value::as_str)
        .is_some_and(|event| event != "interval")
    {
        return None;
    }

    let data = root.get("data").unwrap_or(&root);
    let interval = data
        .get("interval")
        .or_else(|| data.get("intervals").and_then(|intervals| intervals.get(0)))
        .unwrap_or(data);
    let summary = interval
        .get("sum")
        .or_else(|| interval.get("sum_received"))
        .or_else(|| interval.get("sum_sent"))
        .unwrap_or(interval);
    let elapsed = summary
        .get("end")
        .and_then(Value::as_f64)
        .or_else(|| summary.get("seconds").and_then(Value::as_f64))
        .unwrap_or_default();
    let bytes = summary
        .get("bytes")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let reported_bandwidth = summary
        .get("bits_per_second")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite());
    let bandwidth_bps = reported_bandwidth
        .filter(|value| *value > 0.0)
        .or_else(|| {
            let seconds = summary.get("seconds").and_then(Value::as_f64)?;
            (bytes > 0 && seconds > 0.0).then_some(bytes as f64 * 8.0 / seconds)
        })
        .or_else(|| {
            let total = interval
                .get("streams")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(|stream| stream.get("bits_per_second").and_then(Value::as_f64))
                .filter(|value| value.is_finite() && *value > 0.0)
                .sum::<f64>();
            (total > 0.0).then_some(total)
        })
        .or(reported_bandwidth)?;
    let retransmits = summary.get("retransmits").and_then(Value::as_u64);
    let jitter_ms = summary
        .get("jitter_ms")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .or_else(|| {
            let samples: Vec<f64> = interval
                .get("streams")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(|stream| stream.get("rttvar").and_then(Value::as_f64))
                .filter(|value| value.is_finite() && *value > 0.0)
                .collect();
            (!samples.is_empty()).then(|| samples.iter().sum::<f64>() / samples.len() as f64)
        });
    let latency_ms = interval
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| {
            let samples: Vec<f64> = streams
                .iter()
                .filter_map(|stream| stream.get("rtt").and_then(Value::as_f64))
                .filter(|value| value.is_finite() && *value > 0.0)
                .collect();
            (!samples.is_empty()).then(|| samples.iter().sum::<f64>() / samples.len() as f64)
        })
        .or_else(|| {
            summary
                .get("mean_rtt")
                .or_else(|| summary.get("rtt"))
                .and_then(Value::as_f64)
                .filter(|milliseconds| milliseconds.is_finite() && *milliseconds > 0.0)
        });

    Some(SpeedSampleEvent {
        elapsed,
        bandwidth_bps,
        bytes,
        latency_ms,
        jitter_ms,
        retransmits,
        direction,
    })
}

fn parse_text_number(value: &str, unit: &str) -> Option<f64> {
    let value = value.parse::<f64>().ok()?;
    let multiplier = match unit.to_ascii_lowercase().as_str() {
        "bytes" => 1.0,
        "kbytes" => 1_000.0,
        "mbytes" => 1_000_000.0,
        "gbytes" => 1_000_000_000.0,
        "tbytes" => 1_000_000_000_000.0,
        "bits/sec" => 1.0,
        "kbits/sec" => 1_000.0,
        "mbits/sec" => 1_000_000.0,
        "gbits/sec" => 1_000_000_000.0,
        "tbits/sec" => 1_000_000_000_000.0,
        _ => return None,
    };
    Some(value * multiplier)
}

pub(super) fn parse_text_sample(
    line: &str,
    direction: TransferDirection,
    parallel_streams: u8,
) -> Option<SpeedSampleEvent> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 6 || !tokens.first()?.starts_with('[') {
        return None;
    }
    if parallel_streams > 1 && !tokens.first()?.contains("SUM") {
        return None;
    }

    let interval_index = tokens.iter().position(|token| {
        let Some((start, end)) = token.split_once('-') else {
            return false;
        };
        start.parse::<f64>().is_ok() && end.parse::<f64>().is_ok()
    })?;
    let (_, end) = tokens[interval_index].split_once('-')?;
    let elapsed = end.parse::<f64>().ok()?;

    let bandwidth_index = tokens
        .iter()
        .position(|token| token.to_ascii_lowercase().ends_with("bits/sec"))?;
    let bandwidth = parse_text_number(
        tokens.get(bandwidth_index.checked_sub(1)?)?,
        tokens[bandwidth_index],
    )?;

    let bytes = (interval_index + 2..bandwidth_index)
        .find_map(|index| {
            let unit = tokens.get(index)?;
            if !unit.to_ascii_lowercase().ends_with("bytes") {
                return None;
            }
            parse_text_number(tokens.get(index.checked_sub(1)?)?, unit)
        })
        .map(|value| value as u64)
        .unwrap_or_default();

    let jitter_ms = (bandwidth_index + 1..tokens.len()).find_map(|index| {
        let token = tokens.get(index)?;
        token
            .eq_ignore_ascii_case("ms")
            .then(|| {
                tokens
                    .get(index.checked_sub(1)?)
                    .and_then(|value| value.parse().ok())
            })
            .flatten()
    });
    let retransmits = tokens
        .iter()
        .position(|token| *token == "sender" || *token == "receiver")
        .and_then(|index| index.checked_sub(1))
        .and_then(|index| tokens.get(index)?.parse::<u64>().ok());

    Some(SpeedSampleEvent {
        elapsed,
        bandwidth_bps: bandwidth,
        bytes,
        latency_ms: None,
        jitter_ms,
        retransmits,
        direction,
    })
}
