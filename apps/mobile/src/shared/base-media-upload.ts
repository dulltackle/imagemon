// 飞书普通素材上传的固定上限。API 客户端与本地文件预检共用，避免边界漂移。
export const MAX_BASE_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024;
