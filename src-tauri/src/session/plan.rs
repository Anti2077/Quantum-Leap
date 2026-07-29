use crate::model::{SpeedTestRequest, TestMode, TransferDirection, TransportProtocol};

pub(super) struct SessionPlan {
    pub(super) protocol: TransportProtocol,
    pub(super) streams: u8,
    pub(super) duration: u16,
    pub(super) target_bitrate_bps: u64,
    pub(super) directions: Vec<TransferDirection>,
}

impl SessionPlan {
    pub(super) fn from_request(request: &SpeedTestRequest) -> Self {
        Self {
            protocol: request.effective_protocol(),
            streams: request.effective_parallel_streams(),
            duration: request.effective_duration(),
            target_bitrate_bps: request.target_bitrate_bps,
            directions: if request.test_mode == TestMode::Standard {
                vec![TransferDirection::Upload, TransferDirection::Download]
            } else {
                vec![request.direction]
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ServerMode, SshAuthMethod, TestTopology, UiLanguage};

    fn request(test_mode: TestMode) -> SpeedTestRequest {
        SpeedTestRequest {
            language: UiLanguage::En,
            host: "127.0.0.1".into(),
            ssh_port: 22,
            iperf_port: 5201,
            remote_iperf_path: String::new(),
            local_bind_ip: String::new(),
            server_bind_ip: String::new(),
            server_mode: ServerMode::Existing,
            username: String::new(),
            password: String::new(),
            auth_method: SshAuthMethod::Password,
            private_key_path: String::new(),
            passphrase: String::new(),
            test_mode,
            direction: TransferDirection::Download,
            protocol: TransportProtocol::Udp,
            parallel_streams: 3,
            duration_seconds: 30,
            target_bitrate_bps: 25_000_000,
            reuse_existing_server: false,
            allow_host_key_mismatch: false,
            test_topology: TestTopology::LocalToRemote,
            remote_client: None,
        }
    }

    #[test]
    fn standard_plan_runs_upload_then_download_with_fixed_settings() {
        let plan = SessionPlan::from_request(&request(TestMode::Standard));
        assert_eq!(
            plan.directions,
            vec![TransferDirection::Upload, TransferDirection::Download]
        );
        assert_eq!(plan.protocol, TransportProtocol::Tcp);
        assert_eq!(plan.streams, 8);
        assert_eq!(plan.duration, 10);
    }

    #[test]
    fn advanced_plan_preserves_the_requested_direction_and_settings() {
        let plan = SessionPlan::from_request(&request(TestMode::Advanced));
        assert_eq!(plan.directions, vec![TransferDirection::Download]);
        assert_eq!(plan.protocol, TransportProtocol::Udp);
        assert_eq!(plan.streams, 3);
        assert_eq!(plan.duration, 30);
        assert_eq!(plan.target_bitrate_bps, 25_000_000);
    }
}
