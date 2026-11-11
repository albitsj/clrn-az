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
  if (!room) return false;
  return recoverableRoom(room, session, houseId, summary);
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
  roomListDiagnostic('before-create', rooms);
  if (rooms.length === 0) return;
  await recoverIdleRoom(client, session, house.house_id, rooms, body);
}

/** Recheck a single idle room immediately before deleting it.
 * @param client - Business client.
 * @param session - Current account.
 * @param houseId - Verified house ID.
 * @param rooms - Current list.
 * @param body - Original list request.
 */
async function recoverIdleRoom(client, session, houseId, rooms, body) {
  validateRoomList(rooms, session, houseId);
  const roomId = rooms[0].room_id;
  const current = await request(client, session, `/v1/room/${roomId}`, 'GET');
  if (!unchangedRoom(current, roomId, session, houseId)) {
    throw new Error('测试房间状态或归属已变化；未删除');
  }
  await request(client, session, `/v1/room/${roomId}`, 'DELETE');
  const remaining = await request(client, session, '/v2/building/rooms', 'PUT', body);
  roomListDiagnostic('after-cleanup', remaining);
  validateEmptyRooms(remaining);
  console.error(`已恢复本账号的空闲测试房间：${roomId}`);
}

/** Record only the existing response's count; diagnostics cannot change cleanup results.
 * @param phase - Fixed preparation stage.
 * @param rooms - Existing list response, never copied into logs.
 */
function roomListDiagnostic(phase, rooms) {
  try {
    console.error('ROOM PREPARATION >', JSON.stringify({ phase, count: Array.isArray(rooms) ? rooms.length : null }));
  } catch { /* Diagnostic output cannot replace the original failure. */ }
}

/** Check immutable room ownership.
 * @param room - Real room detail or summary.
 * @param session - Current test session.
 * @param houseId - Verified house.
 */
function ownedRoom(room, session, houseId) {
  if (!identifier.test(room.room_id)) return false;
  return [[room.creator_id, session.userId], [room.building_id, houseId], [room.building_type, 'house']]
    .every(([actual, expected]) => actual === expected);
}

/** Check test naming and absence of gameplay or occupants.
 * @param room - Current room data.
 */
function idleTestRoom(room) {
  const activity = [[room.room_status, 'opening'], [room.timer_status, 'wait_for_timing'],
    [room.timing_at, null], [room.seat_occupied, 0]];
  if (!activity.every(([actual, expected]) => actual === expected)) return false;
  return testRoomName(room.room_name);
}

/** Require a current real authenticated session.
 * @param session - Account session.
 */
function validateSession(session) {
  if (!identifier.test(session?.userId)) throw new Error('准备测试私人房间缺少有效账号会话');
  validateAuthorization(session.authorization);
}

/** Require a house belonging to the locked account.
 * @param house - Real house response.
 * @param session - Current account session.
 */
function validateHouse(house, session) {
  if (!house) throw new Error('测试私人房屋归属不符');
  validateHouseIdentity(house, session);
}

/** Check the house ID and owning user together.
 * @param house - Real house.
 * @param session - Current account.
 */
function validateHouseIdentity(house, session) {
  if (!identifier.test(house.house_id) || house.user_id !== session.userId) {
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

/** Combine independent ownership, activity and official-room checks.
 * @param room - Real room.
 * @param session - Current account.
 * @param houseId - Verified house.
 * @param summary - Whether the list omits official status.
 */
function recoverableRoom(room, session, houseId, summary) {
  return ownedRoom(room, session, houseId) && idleTestRoom(room) && unofficialRoom(room, summary);
}

/** Accept missing official status only for the list summary.
 * @param room - Real room.
 * @param summary - List-summary mode.
 */
function unofficialRoom(room, summary) {
  return room.is_official === false || (summary && room.is_official === undefined);
}

/** Require a genuinely empty list after cleanup.
 * @param rooms - Refetched list.
 */
function validateEmptyRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length !== 0) throw new Error('清理后测试私人房间仍非空');
}

/** Recognize only the existing test room names.
 * @param name - Returned room name.
 */
function testRoomName(name) {
  return name === 'TestRoom' || /^E2E私局[0-9a-z]+$/.test(name);
}

/** Require the account's real bearer authorization.
 * @param value - Current authorization.
 */
function validateAuthorization(value) {
  if (typeof value !== 'string' || !/^Bearer \S+$/i.test(value)) throw new Error('准备测试私人房间缺少有效账号会话');
}

/** Check identity before revalidating ownership and activity.
 * @param room - Refetched detail.
 * @param roomId - Selected cleanup ID.
 * @param session - Current account.
 * @param houseId - Verified house.
 */
function unchangedRoom(room, roomId, session, houseId) {
  if (room?.room_id !== roomId) return false;
  return recoverable(room, session, houseId);
}
