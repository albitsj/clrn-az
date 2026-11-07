import { stageError } from '../network/errors.ts';
import { businessRequest, createStagingClient } from '../network/staging.ts';

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 通过独立选线读取或单次清理测试房间，错误只包含阶段，不包含会话或响应正文。
 * @param client - 当前账号独立网络客户端。
 * @param session - 已核对身份的当前独占账号会话。
 * @param path - 接口路径。
 * @param method - 请求方法。
 * @param body - 可选请求正文。
 */
async function request(client, session, path, method, body) {
  try { return (await businessRequest(client, path, method, body, session.authorization)).result; }
  catch (error) {
    throw stageError(error, '准备测试私人房间');
  }
}

/**
 * 仅识别本账号、本屋内由测试命名且从未开始、没有入座者的非官方房间。
 * @param room - 刚从服务端读取的房间详情。
 * @param session - 当前独占账号会话。
 * @param houseId - 已核对归属的私人房屋编号。
 * @param summary - 列表摘要不返回官方标志，必须随后以详情核对该字段。
 */
function recoverable(room, session, houseId, summary = false) {
  return room && ownedRoom(room, session, houseId) && idleTestRoom(room)
    && (room.is_official === false || (summary && room.is_official === undefined));
}

/**
 * 在账号锁内恢复空闲测试房间；未知数据只报错，不删除，普通用例仍由自己的收尾负责清理。
 * @param session - 金币准备完成后返回的已验证账号会话。
 */
export async function prepareTestAccountRooms(session) {
  const client = createStagingClient();
  try { return await prepareRooms(client, session); }
  finally { client.dispose(); }
}

/** Check ownership and clean only a verified idle test room.
 * @param client - Caller-owned independent business client.
 * @param session - Current test session.
 */
async function prepareRooms(client, session) {
  validateSession(session);
  const house = await request(client, session, `/v10/house/user/${session.userId}`, 'PUT');
  validateHouse(house, session);
  const body = { building_ids: [house.house_id] };
  const rooms = await request(client, session, '/v2/building/rooms', 'PUT', body);
  if (!Array.isArray(rooms)) throw new Error('测试私人房间列表无效');
  if (rooms.length === 0) return;
  validateRoomList(rooms, session, house.house_id);
  const roomId = rooms[0].room_id;
  const current = await request(client, session, `/v1/room/${roomId}`, 'GET');
  if (current?.room_id !== roomId || !recoverable(current, session, house.house_id)) {
    throw new Error('测试房间状态或归属已变化；未删除');
  }
  await request(client, session, `/v1/room/${roomId}`, 'DELETE');
  const remaining = await request(client, session, '/v2/building/rooms', 'PUT', body);
  if (!Array.isArray(remaining) || remaining.length !== 0) throw new Error('清理后测试私人房间仍非空');
  console.error(`已恢复本账号的空闲测试房间：${roomId}`);
}

/** Check immutable room ownership.
 * @param room - Real room detail or summary.
 * @param session - Current test session.
 * @param houseId - Verified house.
 */
function ownedRoom(room, session, houseId) {
  return identifier.test(room.room_id) && room.creator_id === session.userId
    && room.building_id === houseId && room.building_type === 'house';
}

/** Check test naming and absence of gameplay or occupants.
 * @param room - Current room data.
 */
function idleTestRoom(room) {
  return room.room_status === 'opening' && room.timer_status === 'wait_for_timing'
    && room.timing_at === null && room.seat_occupied === 0
    && (room.room_name === 'TestRoom' || /^E2E私局[0-9a-z]+$/.test(room.room_name));
}

/** Require a current real authenticated session.
 * @param session - Account session.
 */
function validateSession(session) {
  if (!identifier.test(session?.userId) || typeof session.authorization !== 'string'
    || !/^Bearer \S+$/i.test(session.authorization)) throw new Error('准备测试私人房间缺少有效账号会话');
}

/** Require a house belonging to the locked account.
 * @param house - Real house response.
 * @param session - Current account session.
 */
function validateHouse(house, session) {
  if (!house || !identifier.test(house.house_id) || house.user_id !== session.userId) {
    throw new Error('测试私人房屋归属不符');
  }
}

/** Refuse unknown, multiple or active rooms before deletion.
 * @param rooms - Current real room summaries.
 * @param session - Account session.
 * @param houseId - Verified house.
 */
function validateRoomList(rooms, session, houseId) {
  if (rooms.length !== 1 || !recoverable(rooms[0], session, houseId, true)) {
    throw new Error('测试账号私人房间非空，且不是可恢复的本人空闲测试房间；未删除');
  }
}
