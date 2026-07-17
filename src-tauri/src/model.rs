use serde::{Deserialize, Serialize};

pub const STANDARD_DURATION_SECONDS: u16 = 10;
pub const STANDARD_PARALLEL_STREAMS: u8 = 8;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestMode {
    Standard,
    Advanced,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransportProtocol {
    Tcp,
    Udp,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestRequest {
    pub host: String,
    pub ssh_port: u16,
    pub iperf_port: u16,
    pub username: String,
    pub password: String,
    pub test_mode: TestMode,
    pub direction: TransferDirection,
    pub protocol: TransportProtocol,
    pub parallel_streams: u8,
    pub duration_seconds: u16,
    pub reuse_existing_server: bool,
    pub allow_host_key_mismatch: bool,
}

impl SpeedTestRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.host.trim().is_empty() || self.host.chars().any(char::is_whitespace) {
            return Err("请输入有效的服务器地址".into());
        }
        if self.username.trim().is_empty() {
            return Err("请输入 SSH 用户名".into());
        }
        if self.password.is_empty() {
            return Err("请输入 SSH 密码".into());
        }
        if self.ssh_port == 0 || self.iperf_port == 0 {
            return Err("端口必须在 1 到 65535 之间".into());
        }
        if self.test_mode == TestMode::Advanced
            && self.duration_seconds != 0
            && !(3..=120).contains(&self.duration_seconds)
        {
            return Err("测速时长必须为 0（持续运行），或在 3 到 120 秒之间".into());
        }
        if self.test_mode == TestMode::Advanced && !(1..=32).contains(&self.parallel_streams) {
            return Err("并发线程必须在 1 到 32 之间".into());
        }
        Ok(())
    }

    pub fn effective_duration(&self) -> u16 {
        if self.test_mode == TestMode::Standard {
            STANDARD_DURATION_SECONDS
        } else {
            self.duration_seconds
        }
    }

    pub fn effective_parallel_streams(&self) -> u8 {
        if self.test_mode == TestMode::Standard {
            STANDARD_PARALLEL_STREAMS
        } else {
            self.parallel_streams
        }
    }

    pub fn effective_protocol(&self) -> TransportProtocol {
        if self.test_mode == TestMode::Standard {
            TransportProtocol::Tcp
        } else {
            self.protocol
        }
    }

    pub fn remote_target(&self) -> RemoteTarget {
        RemoteTarget {
            host: self.host.trim().to_owned(),
            ssh_port: self.ssh_port,
            iperf_port: self.iperf_port,
            username: self.username.trim().to_owned(),
            password: self.password.clone(),
            allow_host_key_mismatch: self.allow_host_key_mismatch,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RemoteTarget {
    pub host: String,
    pub ssh_port: u16,
    pub iperf_port: u16,
    pub username: String,
    pub password: String,
    pub allow_host_key_mismatch: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedStateEvent {
    pub phase: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedPromptEvent {
    pub kind: &'static str,
    pub title: &'static str,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSampleEvent {
    pub elapsed: f64,
    pub bandwidth_bps: f64,
    pub bytes: u64,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub retransmits: Option<u64>,
    pub direction: TransferDirection,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(test_mode: TestMode) -> SpeedTestRequest {
        SpeedTestRequest {
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            username: "tester".into(),
            password: "secret".into(),
            test_mode,
            direction: TransferDirection::Upload,
            protocol: TransportProtocol::Udp,
            parallel_streams: 12,
            duration_seconds: 45,
            reuse_existing_server: false,
            allow_host_key_mismatch: false,
        }
    }

    #[test]
    fn standard_mode_uses_fixed_profile() {
        let request = request(TestMode::Standard);
        assert_eq!(request.effective_protocol(), TransportProtocol::Tcp);
        assert_eq!(
            request.effective_parallel_streams(),
            STANDARD_PARALLEL_STREAMS
        );
        assert_eq!(request.effective_duration(), STANDARD_DURATION_SECONDS);
    }

    #[test]
    fn advanced_mode_preserves_custom_profile() {
        let request = request(TestMode::Advanced);
        assert_eq!(request.effective_protocol(), TransportProtocol::Udp);
        assert_eq!(request.effective_parallel_streams(), 12);
        assert_eq!(request.effective_duration(), 45);
    }

    #[test]
    fn advanced_mode_allows_continuous_duration() {
        let mut request = request(TestMode::Advanced);
        request.duration_seconds = 0;

        assert!(request.validate().is_ok());
        assert_eq!(request.effective_duration(), 0);
    }
}
