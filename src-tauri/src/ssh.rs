mod connection;
mod operations;

pub(crate) use connection::connect;
#[cfg(test)]
pub use operations::RemotePackageManager;
pub use operations::{
    cleanup_remote_client, cleanup_remote_server, start_remote_server, RemoteServer, SshError,
};
pub(crate) use operations::{parse_remote_iperf_error, remote_client_command, CLIENT_PID_MARKER};
