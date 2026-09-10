# Restore deleted user filter condition

**Category:** regression

### Prompt
In src/users.js, getActiveUsers(users) has a regression where it forgot to filter out deleted users. Restore the condition !user.isDeleted alongside user.active.
