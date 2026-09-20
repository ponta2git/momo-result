-- Other groups may still need history. This queue's owner is the only supported retention scope.
local groups = redis.call('XINFO', 'GROUPS', KEYS[1])
if #groups ~= 1 then return 0 end
local name, delivered
for index = 1, #groups[1], 2 do
  if groups[1][index] == 'name' then name = groups[1][index + 1] end
  if groups[1][index] == 'last-delivered-id' then delivered = groups[1][index + 1] end
end
if name ~= ARGV[1] or not delivered then return 0 end

-- Compare decimal components without converting Redis's 64-bit IDs to Lua doubles.
local function before(left, right)
  local lm, ls = string.match(left, '^(%d+)%-(%d+)$')
  local rm, rs = string.match(right, '^(%d+)%-(%d+)$')
  if #lm ~= #rm then return #lm < #rm end
  if lm ~= rm then return lm < rm end
  if #ls ~= #rs then return #ls < #rs end
  return ls < rs
end

local floor = delivered
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1)
if #pending > 0 and before(pending[1][1], floor) then floor = pending[1][1] end
-- Keep the boundary itself: it may still be pending or become readable after a cursor reset.
return redis.call('XTRIM', KEYS[1], 'MINID', '~', floor, 'LIMIT', ARGV[2])
