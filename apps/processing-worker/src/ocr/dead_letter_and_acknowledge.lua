-- Validate the source before writing the diagnostic. A failing XADD must leave the source pending.
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 then return 0 end
redis.call('XADD', KEYS[2], '*', unpack(ARGV, 3))
return redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
