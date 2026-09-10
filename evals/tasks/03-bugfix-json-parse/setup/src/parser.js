function safeParseJson(str, fallback) {
  return JSON.parse(str);
}
module.exports = { safeParseJson };
