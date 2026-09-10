function getActiveUsers(users) {
  return users.filter((u) => u.active && !u.isDeleted);
}
module.exports = { getActiveUsers };
