/*
 * JuanFiTelnetClient -- a maintained fork of ESP8266-Telnet-Client by Alessio
 * Villa (https://github.com/esp8266/Arduino/tree/master/libraries/ESP8266TelnetClient),
 * vendored into the sketch folder so the fixes below ship with the firmware.
 *
 * WHY THIS FORK EXISTS
 *
 * The upstream client has three unbounded waits. Every one of them is
 *   while (this->client->available() == 0) delay(1);
 * which never exits. If the MikroTik stops echoing -- router reboot, telnet
 * service disabled, session reaped, cable pulled on the WAN side -- the ESP
 * spins inside send() or listenUntil() forever. Because that spin happens
 * before loop() reaches server.handleClient(), the whole unit dies: no captive
 * portal, no admin UI, no coin expiry, no watchdog. Recovery is a power cycle.
 * A single router hiccup can therefore brick a deployed hotspot.
 *
 * The fork replaces each unbounded wait with waitReadable(), which gives up
 * after a bounded interval and also aborts early if the socket has closed.
 * Failures propagate as false instead of hanging, so JuanFi-nodemcu.ino can
 * mark the router link unhealthy and re-login rather than wedge.
 *
 * Also fixed here:
 *   - MAX_OUT_BUFFER_LENGTH raised 150 -> 200. The credit script built by
 *     addTimeToVoucher() is ~148 bytes with a long vendor name, which was one
 *     byte from being silently discarded by send()'s strlcat length check.
 *   - negotiate() read a second and third byte without checking that they had
 *     arrived, so an IAC WILL/Do exchange could block on a stalled peer.
 *   - login() checked the return value of only its first listenUntil().
 *
 * Third fix, added with the /convertVoucher endpoint: reply capture. Upstream
 * reads the router's answer byte by byte and throws it away, so JuanFi-nodemcu
 * .ino could never tell a RouterOS "no such item" from a clean write. The
 * fork keeps the last REPLY_CAPTURE_LENGTH bytes so callers can look for
 * RouterOS error text or read a value back with :put. Errors are detected by
 * substring match against a fixed list, so a match is possible but harmless:
 * the only consumer treats a match as "did not happen" and refuses to delete
 * the customer's code. Failing closed is the safe direction for money.
 *
 * Behaviour is otherwise identical to upstream, on purpose. Test with real
 * hardware before pushing.
 */

#ifndef JUANFITELENETCLIENT_H
#define JUANFITELENETCLIENT_H

#include <ESP8266WiFi.h>

//#define TNDBG 1
//#define MT_VM 1 // for me to work with a virtual machine running a mikrotik router

#ifdef TNDBG
 #define DEBUG_PRINT(x)  Serial.println (x)
#else
#define DEBUG_PRINT(x)
#endif

#define ARRAYSIZE(arr) (sizeof(arr) / sizeof(arr[0]))
const uint8_t NEGOTIATION_DELAY = 100;

////////////////CONFIGURATION////////////////////////////////////////////////////////////////////////////////////////////////////
//how long the command sent may be long
const uint16_t MAX_OUT_BUFFER_LENGTH = 256;
//how many bytes of the router's reply are kept for the caller's inspection.
//Long enough for the echo of a full command line plus a :put read-back.
const uint16_t REPLY_CAPTURE_LENGTH = 256;
//how long you'll wait for an expected answer from the server
const unsigned int LISTEN_TOUT = 5000;
//how long we wait for the router to echo a byte back while sending. Upstream
//waits forever here; this is the single most dangerous wait in the library.
const unsigned int ECHO_TOUT = 2000;
//how long, after a "prompt char" is received you can confirm it's the real prompt and not just part of the server's answer
const uint16_t PROMPT_REC_TOUT = 300;
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

class JuanFiTelnetClient{

public:

    JuanFiTelnetClient(WiFiClient& client);

    bool login(IPAddress serverIpAddress, const char* username, const char* password, uint8_t port = 23);
    bool sendCommand(const char* cmd);
    void disconnect();
    void setPromptChar(char c);
    // true while the underlying socket believes it is still up. Note this is
    // only a liveness hint: TCP will happily report a dead peer as connected
    // until the retransmit budget runs out, which is why sendCommand() also
    // has to check that its exchange completed.
    bool isConnected();

    // ---- reply capture ------------------------------------------------
    // Forget everything captured so far. Call this immediately before the
    // command whose answer you want to inspect.
    void clearReply();
    // True if the captured reply contains needle. Null-terminated, so a short
    // needle is the useful case ("no such item", "JF=").
    bool replyContains(const char* needle);
    // Index of needle in the captured reply, or -1. Lets a caller read a value
    // the router printed with :put.
    int replyIndexOf(const char* needle);
    // Same, but the last match instead of the first. Needed when the needle is
    // also part of the command the router echoes back.
    int replyLastIndexOf(const char* needle);
    // The captured text that follows the LAST needle, up to the end of that
    // line, with the carriage return and newline removed. Empty when needle is
    // absent. Last, not first, because the router echoes the command line back
    // before running it: for ":put (\"JF=\" . $jfa . ...)" the echoed line
    // contains JF= too, and only the output that follows it is the value. This
    // is the only way to get a value back out of the router, since nothing here
    // parses the reply.
    String replyLineAfter(const char* needle);

private:

    WiFiClient* client;
    char m_promptChar = '>';

    char m_reply[REPLY_CAPTURE_LENGTH];
    uint16_t m_replyLen = 0;
    // Set once the capture window is full, so the caller can tell a truncated
    // reply from a short one.
    bool m_replyTruncated = false;

    bool send(const char* buf, bool waitEcho = true);
    void negotiate();
    void listen();
    bool listenUntil(char c);
    bool waitPrompt();
    void print(char c);
    // print() plus one byte into the capture window.
    void capture(char c);
    // Bounded replacement for upstream's "while (available() == 0) delay(1)".
    // Returns false on timeout or on a closed socket.
    bool waitReadable(unsigned long timeoutMs);
};

#endif
