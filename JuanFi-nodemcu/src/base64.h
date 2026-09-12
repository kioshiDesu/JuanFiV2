// Minimal base64 encoder shim (written for JuanFiV2, public domain).
//
// Why this exists: the firmware only ever calls base64::encode(String) once
// (admin Basic-auth). Historically that resolved to assorted third-party libs
// on case-insensitive Windows setups; on case-sensitive systems (Linux CI)
// `#include <base64.h>` resolved to nothing. This header makes the build
// deterministic on ESP8266 + ESP32, Arduino IDE and arduino-cli alike.
// Files placed in the sketch `src/` dir are compiled and on the include path
// automatically, so no IDE setup is needed.
#ifndef JUANFI_BASE64_H
#define JUANFI_BASE64_H

#include <Arduino.h>

namespace base64 {

inline String encode(const uint8_t *data, size_t len) {
  static const char *alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    uint32_t triple = (uint32_t)data[i] << 16;
    if (i + 1 < len) triple |= (uint32_t)data[i + 1] << 8;
    if (i + 2 < len) triple |= data[i + 2];
    out += alphabet[(triple >> 18) & 0x3F];
    out += alphabet[(triple >> 12) & 0x3F];
    out += (i + 1 < len) ? alphabet[(triple >> 6) & 0x3F] : '=';
    out += (i + 2 < len) ? alphabet[triple & 0x3F] : '=';
  }
  return out;
}

inline String encode(const String &text) {
  return encode((const uint8_t *)text.c_str(), text.length());
}

}  // namespace base64

#endif  // JUANFI_BASE64_H
