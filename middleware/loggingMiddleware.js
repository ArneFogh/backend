module.exports = (req, res, next) => {
    console.log(`Received ${req.method} request to ${req.url}`);
    next();
  };