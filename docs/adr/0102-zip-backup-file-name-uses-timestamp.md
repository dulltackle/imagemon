# ZIP 备份文件名使用时间戳规则

ZIP 备份导出文件名使用固定规则 `imagemon-backup-YYYYMMDD-HHMMSS.zip`，时间取设备本地时区。文件名只用于帮助使用者识别和管理备份文件，不参与恢复兼容性、完整性或内容校验；恢复流程只信任 ZIP 内的 manifest。
