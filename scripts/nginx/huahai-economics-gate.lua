local bit = require("bit")
local ok, config = pcall(dofile, "/www/server/huahai-economics/credentials.lua")
ngx.header["Cache-Control"] = "no-store, private"
ngx.header["Pragma"] = "no-cache"
ngx.header["X-Robots-Tag"] = "noindex, nofollow, noarchive"
ngx.header["X-Frame-Options"] = "DENY"
ngx.header["X-Content-Type-Options"] = "nosniff"
ngx.header["X-Huahai-Economics-Gate"] = "v1"
ngx.header["Content-Type"] = "text/html; charset=utf-8"
if not ok or type(config) ~= "table" or type(config.secret) ~= "string" or #config.secret < 32 or type(config.password_mac) ~= "string" or #config.password_mac ~= 40 then
    return ngx.exit(503)
end

local function equal(a, b)
    if type(a) ~= "string" or type(b) ~= "string" or #a ~= #b then return false end
    local difference = 0
    for i = 1, #a do difference = bit.bor(difference, bit.bxor(a:byte(i), b:byte(i))) end
    return difference == 0
end
local function mac(value)
    return (ngx.hmac_sha1(config.secret, value):gsub(".", function(c) return string.format("%02x", c:byte()) end))
end
local function show(filename, status, message)
    local file = io.open("/www/wwwroot/huahainongke.com/jjxmx/" .. filename, "rb")
    if not file then return ngx.exit(503) end
    local content = file:read("*a")
    file:close()
    ngx.status = status
    ngx.print((content:gsub("{{ERROR}}", message or "")))
    return ngx.exit(status)
end
local function same_origin()
    local origin = ngx.req.get_headers()["origin"]
    return origin == "https://huahainongke.com" or origin == "https://www.huahainongke.com"
end
local uri = ngx.var.uri
local method = ngx.req.get_method()
if uri == "/jjxmx/login" then
    if method ~= "POST" then return ngx.exit(405) end
    if not same_origin() then return ngx.exit(403) end
    if not (ngx.var.content_type or ""):match("^application/x%-www%-form%-urlencoded") then return ngx.exit(415) end
    local attempts = ngx.shared.huahai_economics_attempts
    local key = ngx.var.remote_addr
    attempts:add(key, 0, 600)
    local count = attempts:incr(key, 1)
    if not count then return ngx.exit(503) end
    if count > 6 then
        ngx.header["Retry-After"] = "600"
        return show("login.html", 429, "尝试次数过多，请在 10 分钟后重试。")
    end
    ngx.req.read_body()
    local args, err = ngx.req.get_post_args(4)
    local password = args and args.password
    if err or type(password) ~= "string" or #password ~= 6 or not password:match("^%d+$") or not equal(mac("password:" .. password), config.password_mac) then
        return show("login.html", 401, "密码不正确，请重新输入。")
    end
    attempts:delete(key)
    local expires = tostring(ngx.time() + 43200)
    ngx.header["Set-Cookie"] = "huahai_jjxmx=" .. expires .. "." .. mac("session:" .. expires) .. "; Path=/jjxmx; Max-Age=43200; HttpOnly; Secure; SameSite=Strict"
    return ngx.redirect("/jjxmx", 303)
end
if uri == "/jjxmx/logout" then
    if method ~= "POST" then return ngx.exit(405) end
    if not same_origin() then return ngx.exit(403) end
    ngx.header["Set-Cookie"] = "huahai_jjxmx=; Path=/jjxmx; Max-Age=0; HttpOnly; Secure; SameSite=Strict"
    return ngx.redirect("/jjxmx", 303)
end
if uri ~= "/jjxmx" and uri ~= "/jjxmx/" and uri ~= "/jjxmx/index.html" then return ngx.exit(404) end
if method ~= "GET" and method ~= "HEAD" then return ngx.exit(405) end
local expires, signature = (ngx.var.cookie_huahai_jjxmx or ""):match("^(%d+)%.([a-f0-9]+)$")
local expiry = tonumber(expires)
if expiry and expiry > ngx.time() and expiry <= ngx.time() + 43200 and equal(signature, mac("session:" .. expires)) then
    return show("index.html", 200)
end
return show("login.html", 200)
