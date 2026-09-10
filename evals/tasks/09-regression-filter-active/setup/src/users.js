function getActiveUsers(users) {
  // Regression: deleted users are being returned
  return users.filter((u) => u.active);
}
module.exports = { getActiveUsers };
