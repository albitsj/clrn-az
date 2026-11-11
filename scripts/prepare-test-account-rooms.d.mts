/** 核对独占账号并仅清理其空闲测试房间。
 * @param session - 当前已验证账号会话。
 */
export function prepareTestAccountRooms(session: { userId: string; username: string; authorization: string }): Promise<void>;
