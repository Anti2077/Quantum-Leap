use crate::model::UiLanguage;

const ENGLISH_REPLACEMENTS: &[(&str, &str)] = &[
    ("测速发起端的 SSH 主机密钥与 known_hosts 不一致。确认指纹可信后才能继续。", "The test initiator's SSH host key differs from known_hosts. Verify the fingerprint before continuing."),
    ("known_hosts 中的密钥与服务器当前密钥不一致。确认指纹可信后才能继续。", "The server's current SSH host key differs from known_hosts. Verify the fingerprint before continuing."),
    ("目标端口已有服务监听。继续将直接复用它，完成后不会终止该服务。", "A service is already listening on the target port. Continuing will reuse it and leave it running when the test finishes."),
    ("未识别到可用的包管理器，请登录服务器手动安装 iperf3 3.12 或更高版本。", "No supported package manager was detected. Sign in to the server and install iperf3 3.12 or later manually."),
    ("请登录测速发起端手动安装 iperf3 3.12 或更高版本。", "Sign in to the test initiator and install iperf3 3.12 or later manually."),
    ("无法连接远端 iperf3 服务，请检查防火墙和测速端口", "Unable to connect to the remote iperf3 service. Check the firewall and test port."),
    ("未检测到服务运行，请排查地址和端口", "No running service was detected. Check the address and port."),
    ("测速时长必须为 0（持续运行），或在 3 到 120 秒之间", "Duration must be 0 (continuous) or between 3 and 120 seconds."),
    ("远端 iperf3 路径必须是有效的绝对路径，例如 /opt/bin/iperf3", "The remote iperf3 path must be a valid absolute path, such as /opt/bin/iperf3."),
    ("测速发起端绑定 IP 必须是有效的 IPv4 或 IPv6 地址", "The initiator bind IP must be a valid IPv4 or IPv6 address."),
    ("本机客户端绑定 IP 必须是有效的 IPv4 或 IPv6 地址", "The local client bind IP must be a valid IPv4 or IPv6 address."),
    ("服务端绑定 IP 必须是有效的 IPv4 或 IPv6 地址", "The server bind IP must be a valid IPv4 or IPv6 address."),
    ("绑定 IP 必须是有效的 IPv4 或 IPv6 地址", "The bind IP must be a valid IPv4 or IPv6 address."),
    ("本机客户端 iperf3 不支持绑定 IP（-B）", "The local client iperf3 does not support binding an IP address (-B)"),
    ("测速发起端 iperf3 不支持绑定 IP（-B）", "The initiator iperf3 does not support binding an IP address (-B)"),
    ("服务端 iperf3 不支持绑定 IP（-B）", "The server iperf3 does not support binding an IP address (-B)"),
    ("本机未找到 iperf3；请使用 Homebrew 安装，或设置 IPERF3_PATH", "iperf3 was not found locally. Install it with Homebrew or set IPERF3_PATH."),
    ("测速发起端 SSH 端口必须在 1 到 65535 之间", "The initiator SSH port must be between 1 and 65535."),
    ("测速发起端 SSH 主机密钥", "the test initiator SSH host key"),
    ("测速发起端检测到", "Detected on the test initiator:"),
    ("请执行下面的命令，安装完成后重新检测。", "Run the command below, then check again."),
    ("已检测到", "Detected"),
    ("请登录服务器执行下面的命令，安装完成后重新检测。", "Run the command below on the server, then check again."),
    ("正在建立双端 SSH 安全通道", "Establishing secure SSH connections to both devices"),
    ("正在建立 SSH 安全通道", "Establishing a secure SSH connection"),
    ("正在连接已有测速服务", "Connecting to the existing test service"),
    ("正在结束本地测速，已有服务保持运行", "Finishing the local test; the existing service will remain running"),
    ("正在关闭远端 iperf3 服务", "Stopping the remote iperf3 service"),
    ("测速完成，已有服务保持运行", "Test complete; the existing service remains running"),
    ("测速完成，远端服务已关闭", "Test complete; the remote service has been stopped"),
    ("测速已中断，持久化服务保持运行", "Test stopped; the persistent service remains running"),
    ("测速已中断，已有服务保持运行", "Test stopped; the existing service remains running"),
    ("测速已中断，远端服务已清理", "Test stopped; the remote service has been cleaned up"),
    ("测速已中断，但远端清理失败：", "The test stopped, but remote cleanup failed: "),
    ("同时远端清理失败：", "Remote cleanup also failed: "),
    ("测速发起端未安装 iperf3", "iperf3 is not installed on the test initiator"),
    ("测速发起端身份已变化", "Test initiator identity changed"),
    ("服务器身份已变化", "Server identity changed"),
    ("检测到已有测速服务", "Existing test service detected"),
    ("远端未安装 iperf3", "iperf3 is not installed remotely"),
    ("测速服务不可用", "Test service unavailable"),
    ("等待确认后继续", "Waiting for confirmation"),
    ("正在停止测速", "Stopping the test"),
    ("已有测速任务正在运行", "A test is already running"),
    ("测速状态不可用", "Test state is unavailable"),
    ("测速发起端状态异常", "The test initiator is in an unexpected state"),
    ("测速发起端：", "Test initiator: "),
    ("服务器地址：", "Server address: "),
    ("SSH 地址：", "SSH address: "),
    ("测速目标：", "Test target: "),
    ("测速端口：", "Test port: "),
    ("请输入有效的测速发起端地址", "Enter a valid test initiator address."),
    ("请输入测速发起端 SSH 用户名", "Enter the test initiator SSH username."),
    ("请输入测速发起端 SSH 密码", "Enter the test initiator SSH password."),
    ("请输入测速发起端 SSH 私钥路径", "Enter the test initiator SSH private key path."),
    ("请填写测速发起端 SSH 信息", "Enter the test initiator SSH settings."),
    ("请输入有效的服务器地址", "Enter a valid server address."),
    ("请输入 SSH 用户名", "Enter an SSH username."),
    ("请输入 SSH 密码", "Enter an SSH password."),
    ("请输入 SSH 私钥路径", "Enter an SSH private key path."),
    ("端口必须在 1 到 65535 之间", "The port must be between 1 and 65535."),
    ("并发线程必须在 1 到 32 之间", "Parallel streams must be between 1 and 32."),
    ("服务器备注不能超过 48 个字符", "The server note cannot exceed 48 characters."),
    ("服务器地址不能为空", "The server address cannot be empty."),
    ("SSH 模式需要填写用户名", "SSH mode requires a username."),
    ("密码登录需要填写 SSH 密码", "Password authentication requires an SSH password."),
    ("密钥登录需要填写私钥路径", "Key authentication requires a private key path."),
    ("常用服务器不存在", "The saved server does not exist."),
    ("常用服务器存储状态不可用", "Saved-server storage is unavailable."),
    ("常用服务器存储路径无效", "The saved-server storage path is invalid."),
    ("读取常用服务器", "Read saved servers"),
    ("保存常用服务器", "Save saved server"),
    ("删除常用服务器", "Delete saved server"),
    ("读取服务器密码", "Read server password"),
    ("常用服务器任务失败", "saved-server task failed"),
    ("无法确定常用服务器存储目录", "Unable to determine the saved-server storage directory"),
    ("创建配置目录失败", "Unable to create the configuration directory"),
    ("写入常用服务器失败", "Unable to write saved servers"),
    ("解析常用服务器失败", "Unable to parse saved servers"),
    ("序列化常用服务器失败", "Unable to serialize saved servers"),
    ("清理任务异常结束", "The cleanup task ended unexpectedly"),
    ("SSH 主机密钥与 known_hosts 不一致。SHA256 指纹：", "The SSH host key differs from known_hosts. SHA256 fingerprint: "),
    ("SSH 主机密钥校验失败", "SSH host key verification failed"),
    ("SSH 密码认证失败", "SSH password authentication failed"),
    ("SSH 私钥认证失败", "SSH private key authentication failed"),
    ("SSH 认证未通过", "SSH authentication failed"),
    ("SSH 握手失败", "SSH handshake failed"),
    ("创建 SSH 会话失败", "Unable to create the SSH session"),
    ("打开 SSH 通道失败", "Unable to open the SSH channel"),
    ("关闭 SSH 通道失败", "Unable to close the SSH channel"),
    ("执行远端命令失败", "Unable to execute the remote command"),
    ("无法解析服务器地址", "Unable to resolve the server address"),
    ("服务器地址没有可用的网络端点", "The server address has no usable network endpoint"),
    ("连接 SSH 失败", "Unable to connect over SSH"),
    ("远端 iperf3 路径不可执行", "The remote iperf3 path is not executable"),
    ("远端 iperf3 已启动，但未返回进程 PID", "Remote iperf3 started but did not return a process ID"),
    ("远端服务器未安装 iperf3", "iperf3 is not installed on the remote server"),
    ("测速端口已有服务正在监听", "A service is already listening on the test port"),
    ("启动本地 iperf3 失败", "Unable to start local iperf3"),
    ("无法读取 iperf3 标准输出", "Unable to read iperf3 standard output"),
    ("无法读取 iperf3 错误输出", "Unable to read iperf3 error output"),
    ("等待本地 iperf3 退出失败", "Unable to wait for local iperf3 to exit"),
    ("iperf3 测速失败", "iperf3 test failed"),
    ("iperf3 异常退出", "iperf3 exited unexpectedly"),
    ("iperf3 已结束，但没有产生实时采样", "iperf3 ended without producing live samples"),
    ("iperf3 没有产生采样", "iperf3 produced no samples"),
    ("远端 iperf3 测速失败", "Remote iperf3 test failed"),
    ("远端 iperf3 client 异常退出（退出码 ", "Remote iperf3 client exited unexpectedly (status "),
    ("远端 iperf3 已结束，但没有产生实时采样", "Remote iperf3 ended without producing live samples"),
    ("远端 iperf3 没有产生采样", "Remote iperf3 produced no samples"),
    ("远端测速任务异常结束", "The remote test task ended unexpectedly"),
    ("打开测速发起端 SSH 通道失败", "Unable to open the test initiator SSH channel"),
    ("执行远端 iperf3 client 失败", "Unable to run the remote iperf3 client"),
    ("读取远端 iperf3 输出失败", "Unable to read remote iperf3 output"),
    ("读取远端 iperf3 错误输出失败", "Unable to read remote iperf3 error output"),
    ("读取远端 iperf3 退出状态失败", "Unable to read the remote iperf3 exit status"),
    ("关闭测速发起端 SSH 通道失败", "Unable to close the test initiator SSH channel"),
    ("清理远端 iperf3 client 失败", "Unable to clean up the remote iperf3 client"),
    ("清理远端 iperf3 失败", "Unable to clean up remote iperf3"),
    ("远端 iperf3 清理失败", "Remote iperf3 cleanup failed"),
    ("正在进行", "Running "),
    ("上传", "upload"),
    ("下载", "download"),
    ("测试", " test"),
    ("并发", "streams"),
    ("复用已有服务", "reusing existing service"),
    ("失败", "failed"),
    ("不可用", "unavailable"),
    ("；", "; "),
    ("：", ": "),
    ("（退出码 ", "(status "),
    ("）", ")"),
];

pub fn localize(language: UiLanguage, message: impl AsRef<str>) -> String {
    let original = message.as_ref();
    if language == UiLanguage::ZhCn {
        return original.to_owned();
    }
    let mut translated = original.to_owned();
    for (source, replacement) in ENGLISH_REPLACEMENTS {
        translated = translated.replace(source, replacement);
    }
    if translated.chars().any(is_han) {
        "The operation failed. Check the connection settings and try again.".to_string()
    } else {
        translated
    }
}

fn is_han(character: char) -> bool {
    matches!(character, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{f900}'..='\u{faff}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_dynamic_validation_messages() {
        assert_eq!(
            localize(UiLanguage::En, "端口必须在 1 到 65535 之间"),
            "The port must be between 1 and 65535."
        );
        assert_eq!(
            localize(UiLanguage::ZhCn, "端口必须在 1 到 65535 之间"),
            "端口必须在 1 到 65535 之间"
        );
    }

    #[test]
    fn english_output_never_leaks_app_generated_chinese() {
        let output = localize(UiLanguage::En, "未知的中文错误");
        assert!(!output.chars().any(is_han));
    }
}
