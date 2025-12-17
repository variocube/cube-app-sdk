// Disable native optimizations in the `ws` package, so we
// don't need to bundle native code for the different platforms.
process.env.WS_NO_BUFFER_UTIL = "true";
process.env.WS_NO_UTF_8_VALIDATE = "true";
