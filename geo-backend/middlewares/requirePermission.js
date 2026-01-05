module.exports = (permission) => {
  return (req, res, next) => {
    const permissions = req.auth?.payload?.permissions;

    console.log("PERMISSIONS:", permissions);

    if (!Array.isArray(permissions)) {
      return res.status(403).json({ message: "No permissions found" });
    }

    if (!permissions.includes(permission)) {
      return res.status(403).json({ message: "Forbidden: missing permission" });
    }

    next();
  };
};
