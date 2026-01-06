// User roles in the system
const ROLES = {
  WORKER: 'worker',
  USER: 'user',
  CONTRACTOR: 'contractor',
  ADMIN: 'admin'
};

// All available roles
const ALL_ROLES = Object.values(ROLES);

module.exports = {
  ROLES,
  ALL_ROLES
};

