/** 在账号独占锁内，只清理经归属及空闲状态双重核对的测试房间。
 * @param session - 当前已验证的独占账号会话。
 */
export function prepareTestAccountRooms(session: { userId: string; authorization: string }): Promise<void>;
