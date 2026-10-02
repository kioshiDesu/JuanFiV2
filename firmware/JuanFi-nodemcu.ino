/*waitTime
 * 
 * JuanFi v2.1
 * 
 * PisoWifi coinslot system with integration to Mikrotik Hotspot, 
 * Using
 * 
 * Features
 * 
 * Coinslot System
 *    -Mikrotik integration
 *    -Pause expiration
 *    -Codeless generation
 * 
 * Admin System
 *   - Initial setup of the system
 *   - Mikrotik connection setup, SSID setup, coinslot settings
 *   - Promo Rates configuration ( Rates, expiration)
 *   - Dashboard, Sales report
 * 
 * Supported ESP8266 only (NodeMCU / D1 mini). Ethernet LAN base removed.
 * 
 * Created by Ivan Julius Alayan
 * 
*/

//increase always when publishing a new version for tracking
#define CURRENT_VERSION "2.4"

#include "JuanFiTelnetClient.h"
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266mDNS.h>
#include <DNSServer.h>
#include <Arduino.h>
#include <flash_hal.h>


#include <EEPROM.h>
#include "FS.h"
#include <base64.h>

int TURN_OFF = 0;
int TURN_ON = 1;



volatile int coin = 0;
volatile int processCoin = 0;
volatile int totalCoin = 0;
boolean isNewVoucher = false;
// ponytail: coinInserted() is an ISR, so every variable it writes must be
// volatile or the loop can read a stale value and never see the coin.
volatile int coinsChange = 0;
String currentActiveVoucher = "";
String currentMacAttempt = "";
int timeToAdd = 0;
volatile bool coinSlotActive = false;
bool acceptCoin = false;
unsigned long targetMilis = 0;
bool coinExpired = false;
bool mikrotekConnectionSuccess = false;
unsigned long lastTelnetProbe = 0;
bool telnetProbeFailed = false;
// cleared by populateSystemConfiguration() when the saved pin map cannot work.
// The admin UI stays up; activateCoinSlot() refuses to arm.
bool hardwareConfigUsable = true;
String currentMacAddress = "";
String currentIpAddress = "";
String HARDWARE_TYPE = "ESP8266";

typedef struct {
  String rateName;
  int price;
  int minutes;
  int validity;
  int dataLimit;
  String profileName;
} PromoRates;

typedef struct {
  String mac;
  unsigned long unlockTime;
  int attemptCount;
} AttemptMacAddress;

int attemptedMaxCount = 20;
AttemptMacAddress attempted[20];
PromoRates rates[100];
int ratesCount = 0;
int currentValidity = 0;
int currentDataLimit = 0;
String currentRateProfile = "";
String ADMIN_USER = "";
String ADMIN_PW = "";


const int LIFETIME_COIN_COUNT_ADDRESS = 0;
const int COIN_COUNT_ADDRESS = 5;
const int CUSTOMER_COUNT_ADDRESS = 10;
const int RANDOM_MAC_ADDRESS = 15;
const int BACKUP_CONFIG_LENGTH_INDEX = 20;
const int EEPROM_CONFIG_SIZE = 512;
// Longest RouterOS command line the telnet client will accept, including the
// CRLF it appends. Mirrors MAX_OUT_BUFFER_LENGTH in JuanFiTelnetClient.h; the
// sendCommand() wrapper checks against it so an over-long script is reported
// rather than silently dropped by the client's strlcat length test.
const int TELNET_MAX_COMMAND = 254;
// Longest voucher name /convertVoucher accepts. The longest RouterOS line it
// builds repeats the name twice, so this has to stay well under
// TELNET_MAX_COMMAND.
const int MAX_MERGE_VOUCHER_LENGTH = 32;
// how often the telnet link is proved alive with a no-op command. TCP will
// report a dead peer as connected() == true until the retransmit budget runs
// out, which is tens of seconds to minutes. Without a probe the coin slot keeps
// arming against a router that is no longer listening, and every credit fails
// after the customer has already paid.
const unsigned long TELNET_PROBE_INTERVAL = 30000;
const unsigned long HTTP_CHECK_TIMEOUT_MS = 4000;

// RouterOS CLI is assembled by string concatenation and pushed down the telnet
// session, so anything that can terminate a token has to be stripped before it
// reaches sendCommand(). Without this an unauthenticated client on the AP can
// smuggle ";" or a quote into the voucher parameter and run router commands.
String sanitizeRouterOsToken(String value){
  String out = "";
  for (unsigned int i = 0; i < value.length(); i++){
    char c = value.charAt(i);
    if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.'){
      out += c;
    }
  }
  return out;
}

// Same idea for values that land inside a quoted RouterOS string (the hotspot
// user comment). Spaces are kept so vendor names stay readable, but the quote,
// backslash, bracket, separator and control characters that would either escape
// the quotes or start a new command are dropped.
String sanitizeRouterOsComment(String value){
  String out = "";
  for (unsigned int i = 0; i < value.length(); i++){
    char c = value.charAt(i);
    if(c < 32 || c > 126){
      continue;
    }
    if(c == '"' || c == '\\' || c == '$' || c == ';' || c == '[' || c == ']' || c == '`' || c == '=' || c == ','){
      continue;
    }
    out += c;
  }
  return out;
}

// millis() wraps every 49.7 days. Plain ">" on the coin wait window then answers
// backwards for a full cycle, so compare the signed difference instead.
bool timeHasPassed(unsigned long deadline, unsigned long now){
  return (long)(now - deadline) >= 0;
}

// Content comparison that does not short-circuit on the first wrong byte, so a
// caller cannot learn the expected token one character at a time. It still
// returns early on a length mismatch, which is unavoidable with String and not
// useful to an attacker beyond the length.
bool secureEquals(String a, String b){
  if(a.length() != b.length()){
    return false;
  }
  unsigned char diff = 0;
  for (unsigned int i = 0; i < a.length(); i++){
    diff |= (unsigned char)(a[i] ^ b[i]);
  }
  return diff == 0;
}

void ICACHE_RAM_ATTR coinInserted()    
{
  if(coinSlotActive){
    coin = coin + 1;  
    coinsChange = 1;
  }
}


int COIN_SELECTOR_PIN = 0;
int COIN_SET_PIN = 0;
int INSERT_COIN_LED = 0;
int SYSTEM_READY_LED = 0;
int INSERT_COIN_BTN_PIN = 0;
int CHECK_INTERNET_CONNECTION = 0;
int LED_TRIGGER_TYPE = 1;
int IP_ADDRESS_MODE = 0;
int VOUCHER_LOGIN_OPTION = 0;
int VOUCHER_VALIDITY_OPTION = 0;
String VOUCHER_PROFILE = "default";
String VOUCHER_PREFIX = "P";

int MAX_WAIT_COIN_SEC = 30000;
int COINSLOT_BAN_COUNT = 0;
int COINSLOT_BAN_MINUTES = 0;
int SETUP_FINISH = 0;

// GPIO0, GPIO2 and GPIO15 are latched at reset to choose the boot mode and flash
// size, so they are not free to use: an output driven on GPIO2 can hold the chip
// in download mode, and an input on GPIO15 with no external pull reads back the
// strapping value rather than whatever the coin acceptor is doing. Returns false
// and explains itself if any of the five configured pins is unusable.
bool pinsAreUsable(){
  int pins[5] = {COIN_SELECTOR_PIN, COIN_SET_PIN, SYSTEM_READY_LED, INSERT_COIN_LED, INSERT_COIN_BTN_PIN};
  const char * pinNames[5] = {"COIN_SELECTOR_PIN", "COIN_SET_PIN", "SYSTEM_READY_LED", "INSERT_COIN_LED", "INSERT_COIN_BTN_PIN"};
  bool usable = true;
  for(int i = 0; i < 5; i++){
    if(pins[i] < 0 || pins[i] > 16){
      Serial.print(pinNames[i]);
      Serial.print(" = ");
      Serial.print(pins[i]);
      Serial.println(" is not a GPIO this board has");
      usable = false;
    }else if(pins[i] == 0 || pins[i] == 2 || pins[i] == 15){
      Serial.print(pinNames[i]);
      Serial.print(" = ");
      Serial.print(pins[i]);
      Serial.println(" is a boot strapping pin, GPIO0/2/15 are reserved");
      usable = false;
    }
  }
  return usable;
}


//put here your raspi ip address, and login details
IPAddress mikrotikRouterIp (10, 0, 0, 1);
String user = "pisonet";
String pwd = "abc123";
String ssid     = "MikrofffffTik-36DA2B";
String password = "";
String adminAuth = "";
String vendorName = "";


// static address setting
IPAddress local_IP(192, 168, 10, 15);
IPAddress gateway(192, 168, 10, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(192, 168, 10, 1); // this is optional


IPAddress apIP(172, 217, 28, 1);

WiFiClient client2;
WiFiClient client;
JuanFiTelnetClient tc(client);
ESP8266WebServer server(80);
const byte DNS_PORT = 53;
DNSServer dnsServer;

const int WIFI_CONNECT_TIMEOUT = 180000;
const int WIFI_CONNECT_DELAY = 500;

bool networkConnected = false;
bool welcomePrinted = false;
bool manualVoucher = false;

// unsigned: these hold millis() values, which run past the int32 ceiling after
// 24.8 days and would wrap the comparison in the welcome-message path
unsigned long lastSaleTime = 0;
unsigned long thankyou_cooldown = 5000;
long lastPrinted = 0;
String MARQUEE_MESSAGE = "This is marquee";

void setup () { 
                                
  Serial.begin (115200);
  // ponytail: the ESP8266 core does not auto-seed random(), so without this
  // every boot replays the same LCG and generateVoucher() repeats its codes.
  // Chip ID varies per unit, so this needs no calibration.
  randomSeed(ESP.getChipId() ^ millis());
  EEPROM.begin(EEPROM_CONFIG_SIZE);
  if(!SPIFFS.begin()){
    Serial.println("An Error has occurred while mounting SPIFFS");
    return;
  }  
  populateSystemConfiguration(); 
  
  pinMode(COIN_SELECTOR_PIN, INPUT_PULLUP);
  pinMode(INSERT_COIN_LED, OUTPUT);
  pinMode(SYSTEM_READY_LED, OUTPUT);
  pinMode(COIN_SET_PIN, OUTPUT);
  pinMode(INSERT_COIN_BTN_PIN, INPUT_PULLUP);

  // We start by connecting to a WiFi network
  WiFi.mode(WIFI_STA);
  //for static ip configuration
  if(IP_ADDRESS_MODE == 1){
    Serial.print("using static ip address");
    Serial.println(local_IP);
    WiFi.config(local_IP, primaryDNS, gateway, subnet);
  }

  WiFi.begin(ssid.c_str(), password.c_str());
  Serial.println();
  Serial.println();
  Serial.print("Wait for WiFi, connecting to ");
  Serial.print(ssid);

  int second = 0;
  if(SETUP_FINISH == 1){
    while (second <= WIFI_CONNECT_TIMEOUT) {
      networkConnected = (WiFi.status() == WL_CONNECTED);
      Serial.print(".");
      if(networkConnected){
        break;
      }
      digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_OFF));
      delay(WIFI_CONNECT_DELAY);
      digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_ON));
      second += WIFI_CONNECT_DELAY;
    }
    currentIpAddress = WiFi.localIP().toString().c_str();
    currentMacAddress = WiFi.macAddress();
    digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_OFF));
  }else{
    Serial.println("Initial setup detected, no need to connect to AP");
    networkConnected= false;
  }
  
  
  if(networkConnected){
    Serial.println("");
    Serial.println("WiFi connected");
    Serial.print("IP address: ");
    Serial.println(currentIpAddress);
    Serial.print("Mac address: ");
    Serial.println(currentMacAddress);
    Serial.println("Connecting.... ");
    digitalWrite(INSERT_COIN_LED, evaluateTriggerOutput(TURN_OFF));
    digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_OFF));
    digitalWrite(COIN_SET_PIN, LOW);
    Serial.print("Attaching interrupt ");
    attachInterrupt(COIN_SELECTOR_PIN, coinInserted, RISING);
    loginMirotik();
   
    if (MDNS.begin("esp8266")) {
      Serial.println("MDNS responder started");
    }

    server.on("/topUp", topUp);
    server.on("/checkCoin", checkCoin);
    server.on("/useVoucher", useVoucher);
    server.on("/convertVoucher", handleConvertVoucher);
    server.on("/health", handleHealth);
    server.on("/getRates", handleUserGetRates);
    server.on("/cancelTopUp", handleCancelTopUp);
    server.on("/testInsertCoin", testInsertCoin);
    server.onNotFound(handleNotFound);
    welcomePrinted = true;
    
  }else{
    //Soft AP setup
    WiFi.mode(WIFI_AP);
    WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
    WiFi.softAP("JuanFi Setup");
    //if DNSServer is started with "*" for domain name, it will reply with
    //provided IP to all DNS request
    dnsServer.start(DNS_PORT, "*", apIP);

    server.onNotFound([]() {
      server.sendHeader("Location", String("/admin"), true);
      server.send ( 302, "text/plain", "");
    });
  }
  
  server.on("/admin/api/dashboard", handleAdminDashboard);
  server.on("/admin/js/jquery.min.js", handleJquerySript);
  server.on("/admin/api/resetStatistic", handleAdminResetStats);
  server.on("/admin/api/saveSystemConfig", handleAdminSaveSystemConfig);
  server.on("/admin/api/getSystemConfig", handleAdminGetSystemConfig);
  server.on("/admin/api/getRates", handleAdminGetRates);
  server.on("/admin/api/saveRates", handleAdminSaveRates);
  server.on("/admin/api/logout", handleLogout);
  server.on("/admin/api/generateVouchers", handleGenerateVouchers);
  server.on("/admin", handleAdminPage);
  server.on("/admin/viewGeneratedVouchers", handleAdminGeneratedVoucherPage);
  server.on("/admin/updateMainBin", HTTP_POST, handleFileUploadRequest, handleFileUploadStream);
  
  populateRates();
  
  server.begin();
  
  if(mikrotekConnectionSuccess){
    digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_ON));
  }

}


boolean hasUploadError = false;

void handleFileUploadRequest(){
    if (Update.hasError()) {
      server.send(200, F("text/html"), "Upload has error");
    }
    else {
         server.client().setNoDelay(true);
        server.send_P(200, PSTR("text/html"), "Upload done");
        delay(100);
        server.client().stop();
        ESP.restart();
    }
}

//get from https://github.com/esp8266/Arduino/blob/master/libraries/ESP8266HTTPUpdateServer/src/ESP8266HTTPUpdateServer-impl.h
void handleFileUploadStream(){
    HTTPUpload& upload = server.upload();
    if (upload.status == UPLOAD_FILE_START) {
        if(!isAuthorized()){
           handleNotAuthorize();
           return;
        }
        if (upload.name == "filesystem") {
            backupSystemConfig();
            size_t fsSize = ((size_t) &_FS_end - (size_t) &_FS_start);
            close_all_fs();
            if (!Update.begin(fsSize, U_FS)){//start with max available size
              Serial.println("Upload filesystem start failed");
              hasUploadError = true;
            }
        }
        else {
            uint32_t maxSketchSpace = (ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000;
            if (!Update.begin(maxSketchSpace, U_FLASH)) {//start with max available size
                Serial.println("Upload sketch start failed");
                hasUploadError = true;
            }
        }
    }
    else if (upload.status == UPLOAD_FILE_WRITE && !hasUploadError) {
        Serial.printf(".");
        if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
            Serial.println("Upload write failed");
            hasUploadError = true;
        }
    }
    else if (upload.status == UPLOAD_FILE_END && !hasUploadError) {
        if (Update.end(true)) { //true to set the size to the current progress
            Serial.printf("Update Success: %u\nRebooting...\n", upload.totalSize);
        }
        else {
            // The success branch used to be duplicated here, so a failed flash
            // reported "Update Success" and rebooted onto the old image as if it
            // had landed. surface the error instead.
            hasUploadError = true;
            Serial.printf("Update Failed: %u bytes\n", upload.totalSize);
        }
    }
    else if (upload.status == UPLOAD_FILE_ABORTED) {
        Update.end();
        hasUploadError = true;
        Serial.println("Upload aborted");
    }
    delay(0);
}

void backupSystemConfig(){
  Serial.println("Starting to backup system.data");
  String data = readFile("/admin/config/system.data");
  int len = data.length();
  // The backup shares the same 512 byte EEPROM layout as the counters, so an
  // oversized system.data used to run off the end of the array.
  int maxLen = EEPROM_CONFIG_SIZE - (BACKUP_CONFIG_LENGTH_INDEX + 5) - 1;
  if(len <= 0 || len > maxLen){
    Serial.print("Backup skipped, system.data size ");
    Serial.print(len);
    Serial.print(" exceeds the ");
    Serial.print(maxLen);
    Serial.println(" byte EEPROM budget");
    eeWriteInt(BACKUP_CONFIG_LENGTH_INDEX, 0);
    return;
  }
  eeWriteInt(BACKUP_CONFIG_LENGTH_INDEX, len);
  eeWriteString(BACKUP_CONFIG_LENGTH_INDEX+5, data);
}


void handleNotFound()
{
    Serial.println("preflight....");
    if (server.method() == HTTP_OPTIONS)
    {
        Serial.println("Preflight request....");
        server.sendHeader("Access-Control-Allow-Origin", "*");
        server.sendHeader("Access-Control-Max-Age", "10000");
        server.sendHeader("Access-Control-Allow-Methods", "PUT,POST,GET,OPTIONS");
        server.sendHeader("Access-Control-Allow-Headers", "*");
        server.sendHeader("Access-Control-Allow-Credentials", "false");
        server.send(204);
    }
    else
    {
        server.send(404, "text/plain", "");
    }
}

void handleHealth(){
  setupCORSPolicy();
  server.send ( 200, "text/plain", "ok");
}

void handleLogout(){
  server.sendHeader("WWW-Authenticate", "Basic realm=\"Secure\"");
  server.send(401, "text/html", "<html>Authentication failed</html>");
}

void loginMirotik(){

   //WHICH CHARACTER SHOULD BE INTERPRETED AS "PROMPT"?
    tc.setPromptChar('>');

    //this is to trigger manually the login 
    //since it could be a problem to attach the serial monitor while negotiating with the server (it cause the board reset)
    //remove it or replace it with a delay/wait of a digital input in case you're not using the serial monitors
    Serial.print("Logging in to mikrotik ");
    Serial.print(mikrotikRouterIp);
    Serial.print(" using ");
    Serial.print(user);
    Serial.println(" / ********");
    delay(3000);
  
    //PUT HERE YOUR USERNAME/PASSWORD
    mikrotekConnectionSuccess = tc.login(mikrotikRouterIp, user.c_str(), pwd.c_str());
    if(mikrotekConnectionSuccess){
      Serial.println("Login to mikrotek router success");
    }else{
      // ponytail: this used to force the flag back to true as a workaround, which
      // meant a dead or unreachable router still answered every API call as if the
      // coin slot were live: coins were counted and credited, then the telnet
      // commands never landed. Report the real state instead and let
      // handleSystemAbnormal() retry the login.
      Serial.println("Failed to login in mikrotik router, please check mikrotik log");
    }
}

void testInsertCoin(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }  
  String data = server.arg("coin");
  if(coinSlotActive){
    coin += data.toInt();  
    coinsChange = 1;
  }
  server.send(200, "text/plain", "ok");
}

void handleCancelTopUp(){
  
  if(!checkIfSystemIsAvailable(true)){
      return;
  }
  String voucher = server.arg("voucher");
  if(!validateVoucher(voucher)){
      return;
  }
  targetMilis = millis();
  char * keys[] = {"status"};
  char * values[] = {"true"};
  setupCORSPolicy();
  server.send(200, "application/json", toJson(keys, values, 1));
  
}

void eeWriteInt(int pos, int val) {
    byte* p = (byte*) &val;
    EEPROM.write(pos, *p);
    EEPROM.write(pos + 1, *(p + 1));
    EEPROM.write(pos + 2, *(p + 2));
    EEPROM.write(pos + 3, *(p + 3));
    EEPROM.commit();
}

void eeWriteString(int addr, String val) {
  int str_len = val.length() + 1;
  for (int i = addr; i < str_len + addr; ++i)
  {
    EEPROM.write(i, val.charAt(i - addr));
  }
  EEPROM.write(str_len + addr, '\0');
  EEPROM.commit();
}

String eeReadString(int addr, int str_len) {
  String val = "";
  for (int i = addr; i < str_len + addr; ++i)
  {
     val += String(char(EEPROM.read(i)));
  }
  return val;
}

int eeGetInt(int pos) {
  int val;
  byte* p = (byte*) &val;
  *p        = EEPROM.read(pos);
  *(p + 1)  = EEPROM.read(pos + 1);
  *(p + 2)  = EEPROM.read(pos + 2);
  *(p + 3)  = EEPROM.read(pos + 3);
  if( val < 0){
    return 0;
  }else{
    return val;
  }
}

void handleJquerySript(){
  handleFileRead("/admin/js/jquery.min.js");
}

void handleUserGetRates(){
  setupCORSPolicy();
  handleFileRead("/admin/config/rates.data");
}

void handleAdminGetRates(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }  
  handleFileRead("/admin/config/rates.data");
}

void handleAdminSaveRates(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }
  
  String data = server.arg("data");
  handleFileWrite("/admin/config/rates.data", data);
  populateRates();
  server.send(200, "text/plain", "ok");
}

void handleAdminSaveSystemConfig(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }
  
  String data = server.arg("data");
  handleFileWrite("/admin/config/system.data", data);
  server.send(200, "text/plain", "ok");
  delay(2000);
  ESP.restart();
}

void handleAdminGetSystemConfig(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }
  
  handleFileRead("/admin/config/system.data");
}

void handleAdminResetStats(){
   if(!isAuthorized()){
     handleNotAuthorize();
     return;
   }
  
   String type = server.arg("type");
   if(type == "lifeTimeCount"){
    eeWriteInt(LIFETIME_COIN_COUNT_ADDRESS, 0);
   }else if(type == "coinCount"){
    eeWriteInt(COIN_COUNT_ADDRESS, 0);
   }else if(type == "customerCount"){
    eeWriteInt(CUSTOMER_COUNT_ADDRESS, 0);
   }
  server.send(200, "text/plain", "ok");
}

void handleAdminDashboard(){
  if(!isAuthorized()){
    handleNotAuthorize();
    return;
  }
  
  long upTime = millis();
  int lifeTimeCoinCount = eeGetInt(LIFETIME_COIN_COUNT_ADDRESS);
  int coinCount = eeGetInt(COIN_COUNT_ADDRESS);
  int customerCount = eeGetInt(CUSTOMER_COUNT_ADDRESS);
  bool hasInternetConnection = true;
  if(CHECK_INTERNET_CONNECTION == 1){
      hasInternetConnection = hasInternetConnect();
  }
  String data = "";
         data += String(upTime);
         data += String("|");
         data += String(lifeTimeCoinCount);
         data += String("|");
         data += String(coinCount);
         data += String("|");
         data += String(customerCount);
         data += String("|");
         if(hasInternetConnection){
          data += String("1");
         }else{
          data += String("0");
         }
         data += String("|");
         if(mikrotekConnectionSuccess){
          data += String("1");
         }else{
          data += String("0");
         }
         data += String("|");
         data += currentMacAddress;
         data += String("|");
         data += currentIpAddress;
         data += String("|");
         data += HARDWARE_TYPE;
         data += String("|"); 
         data += CURRENT_VERSION;
         
  server.send(200, "text/plain", data);
}

void handleAdminPage(){
  if(!isAuthorized()){
    handleNotAuthorize();
    return;
  }
  
  handleFileRead("/admin/system-config.html");
}

void handleAdminGeneratedVoucherPage(){
  if(!isAuthorized()){
    handleNotAuthorize();
    return;
  }
  
  handleFileRead("/admin/voucher-generate.html");
}



bool isAuthorized(){
  String auth = server.header("Authorization");
  // An unconfigured board has an empty adminAuth, which would make "Basic "
  // the correct answer and let anyone in. Deny until an admin exists.
  if(adminAuth.length() == 0){
    Serial.println("Admin auth not configured, denying request");
    return false;
  }
  return secureEquals(auth, "Basic " + adminAuth);
}

void handleNotAuthorize(){
  server.sendHeader("WWW-Authenticate", "Basic realm=\"Secure\"");
  server.send(401, "text/html", "<html>Authentication failed</html>");
}

bool handleFileRead(String path){  // send the right file to the client (if it exists)
  Serial.println("handleFileRead: " + path);
  if(path.endsWith("/")) path += "index.html";           // If a folder is requested, send the index file
  String contentType = getContentType(path);             // Get the MIME type
  String pathWithGz = path + ".gz";
  if(SPIFFS.exists(pathWithGz) || SPIFFS.exists(path)){  // If the file exists, either as a compressed archive, or normal
    if(SPIFFS.exists(pathWithGz))                          // If there's a compressed version available
      path += ".gz";                                         // Use the compressed version
    File file = SPIFFS.open(path, "r");                    // Open the file
    size_t sent = server.streamFile(file, contentType);    // Send it to the client
    file.close();                                          // Close the file again
    Serial.println(String("\tSent file: ") + path);
    return true;
  }
  Serial.println(String("\tFile Not Found: ") + path);
  return false;                                          // If the file doesn't exist, return false
}

bool handleFileWrite(String path, String content){  // send the right file to the client (if it exists)
  Serial.println("handleFileWrite: " + path);
  if(SPIFFS.exists(path)){
    File file = SPIFFS.open(path, "w");
    int bytesWritten = file.print(content);
    if(bytesWritten <= 0){
      return false;
    }
    file.close();
    Serial.println(String("Write file: ") + path);
    return true;
  }
  Serial.println(String("\tFile Not Found: ") + path);
  return false;                                          // If the file doesn't exist, return false
}

String readFile(String path){ 
  String result;
  if(SPIFFS.exists(path)){
    File file = SPIFFS.open(path, "r");
    String content = file.readStringUntil('\n');
    file.close();
    return content;
  }
  return result;
}

String getContentType(String filename){
  if(filename.endsWith(".html")) return "text/html";
  else if(filename.endsWith(".css")) return "text/css";
  else if(filename.endsWith(".js")) return "application/javascript";
  else if(filename.endsWith(".ico")) return "image/x-icon";
  else if(filename.endsWith(".gz")) return "application/x-gzip";
  return "text/plain";
}

bool checkIfSystemIsAvailable(bool respond){
  if(!mikrotekConnectionSuccess){
    if(respond){
      char * keys[] = {"status", "errorCode"};
      char * values[] = {"false", "coin.slot.notavailable"};
      setupCORSPolicy();
      server.send(200, "application/json", toJson(keys, values, 2));
    }
    return false;
  }else{
    return true;
  }
}



String INTERNET_CHECK_URL = "http://ifconfig.me";

// ifconfig.me answers with nothing but the caller's public address, so an echo
// service is the cheapest captive-portal test available: a hotel or operator
// login page returns 200 with HTML, which must not be read as "online".
bool bodyIsBareIpv4(String value){
  value.trim();
  if(value.length() < 7 || value.length() > 15){
    return false;
  }
  int dots = 0;
  int digits = 0;
  for (unsigned int i = 0; i < value.length(); i++){
    char c = value.charAt(i);
    if(c == '.'){
      if(digits == 0){
        return false;
      }
      dots++;
      digits = 0;
    }else if(c >= '0' && c <= '9'){
      digits++;
    }else{
      return false;
    }
  }
  return (dots == 3 && digits > 0);
}

bool hasInternetConnect(){

  HTTPClient http;

  // ponytail: this ran with the HTTPClient default of 5s inside a request
  // handler, so one unreachable echo service stalled the captive portal for
  // five seconds per top-up attempt. Cap it well under that.
  http.setTimeout(HTTP_CHECK_TIMEOUT_MS);
  if(!http.begin(client2, INTERNET_CHECK_URL)){ //HTTP
    Serial.println("Internet check could not be started");
    return false;
  }
  http.addHeader("User-Agent", "curl/7.55.1");
  int httpCode = http.GET();
  bool online = false;
  // ponytail: any code above zero used to count as online, including a 302 to
  // a captive login page and a 500 from an intercepting proxy. Both let a
  // customer start a top-up on a network that could never reach the MikroTik
  // API, so their coins were counted and then credited to nothing.
  if (httpCode == 200) {
    String payload = http.getString();
    online = bodyIsBareIpv4(payload);
    if(online){
      Serial.println("Internet connection detected!");
    }else{
      Serial.println("Internet check answered with a non-address body, assuming a captive portal");
    }
  }else{
    Serial.println("Internet connection not detected!");
    Serial.printf("[HTTP] GET... failed, error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
  return online;
}

void addAttemptToCoinslot(){
  if(COINSLOT_BAN_COUNT > 0 && (!manualVoucher)){
    int currentMacIndex = -1;
    int availableIndex = -1;
    for(int i=0;i<attemptedMaxCount;i++){
      if (attempted[i].mac == currentMacAttempt){
          currentMacIndex = i;
          break;
      }else if(attempted[i].mac == ""){
        availableIndex = i;
      }
    }
     Serial.println(currentMacAttempt);
     Serial.println(currentMacIndex);
     Serial.println(availableIndex);
    if(currentMacIndex > -1){
      attempted[currentMacIndex].attemptCount++;
     
      if(attempted[currentMacIndex].attemptCount >= COINSLOT_BAN_COUNT){
          attempted[currentMacIndex].unlockTime = millis() + (COINSLOT_BAN_MINUTES * 60000UL);
          Serial.print("Unlock time: ");
          Serial.println(attempted[currentMacIndex].unlockTime);
      }
    }else{
      if(availableIndex > -1){
        attempted[availableIndex].mac = currentMacAttempt;
        attempted[availableIndex].attemptCount++ ;
      }
    }
  }
}

void clearAttemptToCoinSlot(){
  if(COINSLOT_BAN_COUNT > 0){
    for(int i=0;i<attemptedMaxCount;i++){
        if (attempted[i].mac == currentMacAttempt){
            attempted[i].mac = "";
            attempted[i].unlockTime = 0;
            attempted[i].attemptCount = 0;
            break;
        }
    }
  }
}

void checkCoin(){

  if(!checkIfSystemIsAvailable(true)){
      return;
  }
  
  String voucher = server.arg("voucher");
  if(!validateVoucher(voucher)){
      return;
  }

  if(coinExpired){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coins.wait.expired"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }

  if(!acceptCoin){
    totalCoin += processCoin;
    timeToAdd = calculateAddTime();
    char * keys[] = {"status", "newCoin", "timeAdded", "totalCoin", "validity", "data"};
    char coinStr[16];
    itoa(processCoin, coinStr, 10);
    char timeToAddStr[16];
    itoa(timeToAdd, timeToAddStr, 10);
    char totalCoinStr[16];
    itoa(totalCoin, totalCoinStr, 10);
    char validityStr[16];
    itoa(currentValidity, validityStr, 10);
    char currentDataLimitStr[16];
    itoa(currentDataLimit, currentDataLimitStr, 10);
    char * values[] = {"true", coinStr, timeToAddStr, totalCoinStr, validityStr, currentDataLimitStr};
    activateCoinSlot(false);
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 6));
  }else{
    char * keys[] = {"status", "errorCode", "remainTime", "timeAdded", "totalCoin", "waitTime", "validity", "data"};
    char remainTimeStr[20];
    // signed difference so the countdown stays correct across the millis wrap
    long remain = (long)(targetMilis - millis());
    if(remain < 0){
      remain = 0;
    }
    itoa(remain, remainTimeStr, 10);
    char timeToAddStr[16];
    itoa(timeToAdd, timeToAddStr, 10);
    char totalCoinStr[16];
    itoa(totalCoin, totalCoinStr, 10);
    char waitTimeStr[16];
    itoa(MAX_WAIT_COIN_SEC, waitTimeStr, 10);
    char validityStr[16];
    itoa(currentValidity, validityStr, 10);
    char currentDataLimitStr[16];
    itoa(currentDataLimit, currentDataLimitStr, 10);
    char * values[] = {"false", "coin.not.inserted", remainTimeStr, timeToAddStr, totalCoinStr, waitTimeStr, validityStr, currentDataLimitStr};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 8));
  }
}

void useVoucher(){

  if(!checkIfSystemIsAvailable(true)){
      return;
  }

  String voucher = server.arg("voucher");
  if(!validateVoucher(voucher)){
      return;
  }
  disableCoinSlot();
  if(timeToAdd > 0 ){
    clearAttemptToCoinSlot();
    // ponytail: both of these report failure now that sendCommand() surfaces a
    // script the telnet client would not carry and a router that stopped
    // answering. Answering status:true regardless told the customer their time
    // had been added when no RouterOS command ever ran: the coins were in the
    // slot and the voucher stayed empty. Say what actually happened, and put
    // the link in the state handleSystemAbnormal() knows how to recover.
    if(!registerNewVoucher(voucher) || !addTimeToVoucher(voucher, timeToAdd)){
      Serial.println("Voucher credit failed, the router did not accept the command");
      mikrotekConnectionSuccess = false;
      telnetProbeFailed = true;
      char * keys[] = {"status", "errorCode"};
      char * values[] = {"false", "coin.slot.notavailable"};
      setupCORSPolicy();
      server.send(200, "application/json", toJson(keys, values, 2));
      return;
    }
    // only bank the sale once the router has confirmed it, so the counters do
    // not claim revenue that was never credited
    updateStatistic();
  }else{
    addAttemptToCoinslot();
  }
  char * keys[] = {"status", "totalCoin", "timeAdded", "validity"};
  char totalCoinStr[16];
  itoa(totalCoin, totalCoinStr, 10);
  char timeToAddStr[16];
  itoa(timeToAdd, timeToAddStr, 10);
  char validityStr[16];
  itoa(currentValidity, validityStr, 10);
  char * values[] = {"true", totalCoinStr, timeToAddStr, validityStr};
  resetGlobalVariables();
  setupCORSPolicy();
  acceptCoin = false;
  server.send(200, "application/json", toJson(keys, values, 4));
}

// ---------- /convertVoucher ----------
// Fold a second voucher's remaining minutes into the session the box already
// has open, without coins. The portal calls this from
// assets/js/core.js convertVoucherAction(), which posts voucher=<session> and
// convertVoucher=<code> and only understands status:"true" or one of its own
// convertVoucher.* codes. Neither the original JuanFi firmware nor the current
// upstream box had this route, which is why settings.json ships
// showConvertVoucher as opt-out and why the row used to always answer
// convertVoucher.unsupported.
// toJson() takes char*, not const char*, so the literal cannot be passed
// straight through. The codes here are all fixed strings.
void answerConvertVoucher(bool ok, const char* errorCode){
  setupCORSPolicy();
  if(ok){
    char * keys[] = {"status"};
    char * values[] = {"true"};
    server.send(200, "application/json", toJson(keys, values, 1));
    return;
  }
  char * keys[] = {"status", "errorCode"};
  char * values[] = {"false", (char*)errorCode};
  server.send(200, "application/json", toJson(keys, values, 2));
}

// 0 merged, 1 the code cannot be used (router answered, link is fine),
// -1 the router never answered.
int mergeVoucherIntoSession(String sessionVoucher, String mergeVoucher){

  // Read the two remaining times plus whether the code is in use, each behind
  // an on-error guard. A code that does not exist leaves the global at its -1
  // default instead of aborting the line, which is the only way to tell "no
  // such code" apart from "the command never ran" -- and a bare
  // sendCommand() cannot see RouterOS error text inside an on-error block, so
  // these two deliberately do not go through sendCommandChecked().
  //
  // :tonum is not optional here. "get limit-uptime" answers a time value
  // ("00:15:00"), and the guards below compare against numbers.
  String read = ":global jfa; :set jfa -1; :do { :set jfa [:tonum [/ip hotspot user get [find name=";
  read += sessionVoucher;
  read += "] limit-uptime]] } on-error={}";
  if(!sendCommand(read)){
    return -1;
  }

  read = ":global jfb; :global jac; :set jfb -1; :set jac 0; ";
  read += ":do { :set jfb [:tonum [/ip hotspot user get [find name=";
  read += mergeVoucher;
  read += "] limit-uptime]] } on-error={}; ";
  read += ":do { :set jac [:len [/ip hotspot active find user=";
  read += mergeVoucher;
  read += "]] } on-error={}";
  if(!sendCommand(read)){
    return -1;
  }

  // :put is the only way to get a value back out of the router. One reply,
  // three fields, parsed on this side.
  if(!sendCommand(":put (\"JF=\" . $jfa . \"/\" . $jfb . \"/\" . $jac)")){
    return -1;
  }
  String payload = tc.replyLineAfter("JF=");
  if(payload.length() == 0){
    Serial.println("RouterOS did not report the merge values back");
    return -1;
  }
  String field[3];
  split(field, 3, payload, '/');
  int sessionRemaining = field[0].toInt();
  int mergeRemaining = field[1].toInt();
  int mergeInUse = field[2].toInt();
  if(sessionRemaining < 0 || mergeRemaining <= 0){
    // The router answered, so the link is healthy: the code does not exist,
    // or it has no time left. Nothing was written.
    return 1;
  }
  if(mergeInUse > 0){
    // Somebody is logged in on that code right now. Taking it would boot a
    // live customer off their own session.
    Serial.println("Refusing to merge a code that has an active session");
    return 1;
  }

  // The addition has to be time + time, the same shape addTimeToVoucher()
  // already uses. A bare number here is not read as seconds and would either be
  // rejected or land as a wildly wrong value.
  String script = ":if (($jfb>0) and ($jfa>=0)) do={ /ip hotspot user set ";
  script += sessionVoucher;
  script += " limit-uptime=[([:totime $jfa]+[:totime $jfb])] }";
  if(!sendCommandChecked(script)){
    return -1;
  }

  // The expiry scheduler was armed with the original minutes, so it would
  // delete the row when the session ends and take the merged minutes with it.
  // Push its interval out by the same amount. A missing or unreadable
  // scheduler is not fatal here -- the live session still has the time -- so
  // this step uses sendCommand() and lets on-error swallow it.
  script = ":do { :local ji [/system scheduler get [find name=";
  script += sessionVoucher;
  script += "] interval]; /system scheduler set [find name=";
  script += sessionVoucher;
  script += "] interval=($ji+[:totime $jfb]) } on-error={}";
  if(!sendCommand(script)){
    return -1;
  }

  // Retire the merged code last, so every earlier step that could fail has
  // already failed with the customer's code still intact.
  script = "/ip hotspot active remove [find user=";
  script += mergeVoucher;
  script += "]; /system scheduler remove [find name=";
  script += mergeVoucher;
  script += "]; /ip hotspot user remove ";
  script += mergeVoucher;
  if(!sendCommandChecked(script)){
    return -1;
  }

  // The code's session file under the router's hotspot data dir is named after
  // the MAC that logged in, not after the voucher, and this firmware has no
  // handle on that path, so it is left behind. juanfi-setup.rsc's daily sweep
  // reclaims the user and the scheduler; the stale .txt is harmless and the
  // next login for that MAC overwrites it.
  Serial.print("Merged voucher ");
  Serial.print(mergeVoucher);
  Serial.print(" into ");
  Serial.print(sessionVoucher);
  Serial.print(", +");
  Serial.print(mergeRemaining);
  Serial.println("s");
  return 0;
}

void handleConvertVoucher(){

  if(!checkIfSystemIsAvailable(true)){
    return;
  }

  String sessionVoucher = sanitizeRouterOsToken(server.arg("voucher"));
  String mergeVoucher = sanitizeRouterOsToken(server.arg("convertVoucher"));

  if(sessionVoucher.length() == 0){
    answerConvertVoucher(false, "convertVoucher.nosession");
    return;
  }
  // The merge builds six RouterOS command lines and the longest repeats the
  // voucher name twice. Past this length sendCommand() would refuse the script
  // and the refusal would read as a dead router, so an over-long name is
  // turned away here instead. Real codes are far shorter: a minted code is a
  // prefix plus four digits, a MAC voucher is twelve characters.
  if(sessionVoucher.length() > MAX_MERGE_VOUCHER_LENGTH || mergeVoucher.length() > MAX_MERGE_VOUCHER_LENGTH){
    answerConvertVoucher(false, "convertVoucher.refused");
    return;
  }
  if(mergeVoucher.length() == 0 || mergeVoucher == sessionVoucher){
    answerConvertVoucher(false, "convertVoucher.refused");
    return;
  }
  // The box only ever merges into the session it is actually holding open, so
  // a mismatch is a stale browser tab rather than anything the customer did.
  if(sessionVoucher != currentActiveVoucher){
    answerConvertVoucher(false, "coinslot.busy");
    return;
  }

  int merged = mergeVoucherIntoSession(sessionVoucher, mergeVoucher);
  if(merged == 0){
    // No coins changed hands, so updateStatistic() stays out of it.
    answerConvertVoucher(true, "");
    return;
  }
  if(merged == 1){
    answerConvertVoucher(false, "convertVoucher.refused");
    return;
  }
  mikrotekConnectionSuccess = false;
  telnetProbeFailed = true;
  answerConvertVoucher(false, "coin.slot.notavailable");
}

void updateStatistic(){
    int lifeTimeCoinCount = eeGetInt(LIFETIME_COIN_COUNT_ADDRESS);
    lifeTimeCoinCount += totalCoin;
    eeWriteInt(LIFETIME_COIN_COUNT_ADDRESS, lifeTimeCoinCount);
    int coinCount = eeGetInt(COIN_COUNT_ADDRESS);
    coinCount += totalCoin;
    eeWriteInt(COIN_COUNT_ADDRESS, coinCount);
    int customerCount = eeGetInt(CUSTOMER_COUNT_ADDRESS);
    customerCount++;
    eeWriteInt(CUSTOMER_COUNT_ADDRESS, customerCount); 
 }

bool validateVoucher(String voucher){
  if(voucher != currentActiveVoucher){
      char * keys[] = {"status", "errorCode"};
      char * values[] = {"false", "coinslot.busy"};
      setupCORSPolicy();
      server.send(200, "application/json", toJson(keys, values, 2));
      return false;
  }else{
      return true;
  }
}

void topUp() {
  manualVoucher = false;
  thankyou_cooldown = 5000;
  bool hasInternetConnection = true;
  if(CHECK_INTERNET_CONNECTION == 1){
        hasInternetConnection = hasInternetConnect();
  }
  if(!hasInternetConnection){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "no.internet.detected"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }

  if(!checkIfSystemIsAvailable(true)){
      return;
  }

  String macAdd = server.arg("mac");
  if(!checkMacAddress(macAdd)){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coin.slot.banned"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
  currentMacAttempt = macAdd;
  String voucher = sanitizeRouterOsToken(server.arg("voucher"));
   if(currentActiveVoucher != "" && !validateVoucher(voucher)){
      return;
  }
  
  currentValidity = 0;
  // ponytail: isNewVoucher used to be derived from a sticky flag that
  // resetGlobalVariables() never cleared, so a "new voucher" left true by an
  // earlier purchase could leak into the next one and pick the wrong validity
  // rule at addTimeToVoucher(). Derive it from this request instead: reaching
  // this branch means the voucher differs from what the slot already holds, so
  // it is newly minted iff the portal sent an empty code. The mid-session
  // re-topUp retry (same voucher) skips this branch and leaves the flag alone,
  // which is what preserves a code this slot just minted.
  bool voucherWasEmpty = (voucher == "");
  if(voucherWasEmpty){
    voucher = generateVoucher();
  }
  char * keys[] = {"status", "voucher"};
  int voucherLength = voucher.length() + 1;
  char voucherChar [voucherLength];
  voucher.toCharArray(voucherChar, voucherLength);
  char * values[] = {"true", voucherChar};
  if(voucher != currentActiveVoucher){
    resetGlobalVariables();
    isNewVoucher = voucherWasEmpty;
    activateCoinSlot(true);
    currentActiveVoucher = voucher;
  }
  setupCORSPolicy();
  server.send(200, "application/json", toJson(keys, values, 2));
}

boolean checkMacAddress(String mac){
  bool isValid = true;
  if(COINSLOT_BAN_COUNT > 0){
    Serial.print("Checking mac if valid ");
    Serial.println(mac);
    for(int i=0;i<attemptedMaxCount;i++){
      if (attempted[i].mac != ""){
          if( attempted[i].unlockTime > 0 && timeHasPassed(attempted[i].unlockTime, millis())){
            Serial.print(attempted[i].mac);
            Serial.println(" unlocking mac address...");
            attempted[i].mac = "";
            attempted[i].attemptCount = 0;
            attempted[i].unlockTime = 0;
          }else if(attempted[i].mac == mac){
             Serial.print("Mac address has previous attempt");
             Serial.println(attempted[i].attemptCount);
             Serial.println(COINSLOT_BAN_COUNT);
             if( attempted[i].attemptCount >= COINSLOT_BAN_COUNT){
                isValid = false;
                Serial.print(mac);
                Serial.println(" mac address currenly banned");
             }
          }
      }
    }
  }
  return isValid;
}

void setupCORSPolicy(){
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Max-Age", "10000");
  server.sendHeader("Access-Control-Allow-Methods", "PUT,POST,GET,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Credentials", "false");
}

void activateCoinSlot(bool resetWaitWindow){
  // ponytail: this is the single point where the acceptor is told to trust the
  // next coin, so it is also the only place a broken pin map can be caught
  // before money is taken. GPIO0/2/15 are sampled at reset to pick the boot
  // mode, and a short system.data leaves every absent pin field at its
  // initialiser of 0, which is GPIO0. Rather than refuse to boot -- that would
  // strand a deployed unit with no way back except a serial cable -- keep the
  // admin UI reachable and simply never arm the slot.
  if(!hardwareConfigUsable){
    Serial.println("Coin slot left disarmed: the saved pin map is not usable");
    return;
  }
  digitalWrite(COIN_SET_PIN, HIGH);
  delay(200);
  processCoin = 0;
  acceptCoin = true;
  coinSlotActive = true;
  // ponytail: coinExpired was only cleared inside the loop branch that runs only
  // while the wait window is open, so after any in-session expiry the NEXT
  // customer's first checkCoin could answer coins.wait.expired before a coin
  // had even landed. A freshly armed slot is by definition not expired.
  coinExpired = false;
  // ponytail: re-arming the deadline on every checkCoin kept the window open
  // forever while a client polled, so coins.wait.expired could never fire and
  // the coin slot abuse ban never accrued. Only a genuinely new session moves
  // the deadline; re-activating after a coin landed keeps the original one.
  if(resetWaitWindow || targetMilis == 0){
    targetMilis = millis() + MAX_WAIT_COIN_SEC;
  }
  digitalWrite(INSERT_COIN_LED, evaluateTriggerOutput(TURN_ON));
}

String toJson(char * keys[],char * values[],int nField){
  String json = "{";
  
  for (int i = 0; i < nField; i++) {
   if(i > 0){
    json += ",";
   }
   json += " \"";
   json += String(keys[i]);  
   json += "\": \"";
   // a raw quote or backslash in a value would terminate the string and let a
   // caller inject keys or break the parser
   String value = String(values[i]);
   for (unsigned int c = 0; c < value.length(); c++){
     char ch = value.charAt(c);
     if(ch == '"' || ch == '\\'){
       json += '\\';
     }
     json += ch;
   }
   json += "\" ";
  
  }
  json += "}";
  return json;
}

// Is this name already taken on the router? The random code space is only 9000
// wide, so two customers can be handed the same code by chance, and the second
// one to pay extends the first one's session instead of getting time of their
// own -- coins land on a stranger's account. The bulk generator deduplicates
// within its own batch, but nothing deduplicated against codes already sold.
// Ask the router before the code is ever shown to anybody. A router that does
// not answer counts as "free": refusing to mint on a router hiccup would block
// every customer, and this check only exists to reject a name the router has
// positively reported as existing.
bool voucherNameIsTaken(String voucher){
  tc.clearReply();
  String script = ":put (\"JFT=\" . [:len [/ip hotspot user find name=";
  script += voucher;
  script += "]])";
  if(!sendCommand(script)){
    return false;
  }
  String payload = tc.replyLineAfter("JFT=");
  if(payload.length() == 0){
    return false;
  }
  return payload.toInt() > 0;
}

String generateVoucher(){
  String prefix = sanitizeRouterOsToken(VOUCHER_PREFIX);
  String voucher = prefix+String(random(1000, 9999));
  // Four tries is a bound, not a guarantee: it stops a nearly full code space
  // from stalling every top up. A collision the sweep has not reclaimed yet is
  // still caught at credit time, where the router refuses to create a second
  // user with the same name.
  for(int attempt=0; attempt<4; attempt++){
    if(!voucherNameIsTaken(voucher)){
      return voucher;
    }
    Serial.print("Voucher code is already in use, minting another: ");
    Serial.println(voucher);
    voucher = prefix+String(random(1000, 9999));
  }
  return voucher;
}

bool registerNewVoucher(String voucher){
  // sanitize at the boundary: voucher arrives straight off a LAN POST
  String cleanVoucher = sanitizeRouterOsToken(voucher);
  if(cleanVoucher.length() == 0){
    Serial.println("Refusing to register an empty or unsafe voucher name");
    return false;
  }
  String cleanProfile = sanitizeRouterOsToken(VOUCHER_PROFILE);
  String addCoinScript = "/ip hotspot user add name=";
  addCoinScript += cleanVoucher;
  addCoinScript += " limit-uptime=0 comment=0";
  if(VOUCHER_LOGIN_OPTION == 1){
    addCoinScript += " password=";
    addCoinScript += cleanVoucher;
  }
  if(cleanProfile != "" && cleanProfile != "default"){
    addCoinScript += " profile=";
    addCoinScript += cleanProfile;
  }
  return sendCommand(addCoinScript);
}

bool addTimeToVoucher(String voucher, int secondsToAdd){

    String cleanVoucher = sanitizeRouterOsToken(voucher);
    if(cleanVoucher.length() == 0){
      Serial.println("Refusing to credit an empty or unsafe voucher name");
      return false;
    }
    String cleanVendor = sanitizeRouterOsComment(vendorName);
    String cleanProfile = sanitizeRouterOsToken(currentRateProfile);

    String script = ":global lpt; :global nlu; :set lpt [/ip hotspot user get ";
    script += cleanVoucher;
    script += " limit-uptime]; ";
    // the read has to land before the write that depends on it, so a failure
    // here is fatal to the whole credit rather than something to shrug off
    if(!sendCommand(script)){
      return false;
    }
    script = ":set nlu [($lpt+";
    script += (secondsToAdd/60);
    script += "m)]; ";
    script += "/ip hotspot user set limit-uptime=$nlu comment=\"";
    script += currentValidity;
    script += "m," ;
    script += String(totalCoin);
    if(isNewVoucher){
      script += ",0,";
    }else{
      script += ",1,";
    }
    script += cleanVendor;
    script += "\" ";

    if(cleanProfile != ""){
      script += "profile=" ;
      script += cleanProfile;
      script += " ";
    }
    script += cleanVoucher;
    script += "; ";
    if(!sendCommand(script)){
      return false;
    }

    if(currentDataLimit != 0){
      String script = ":global tdtl; :global dtl [/ip hotspot user get VOUCHER_HERE  limit-bytes-total];";
      script.replace("VOUCHER_HERE", cleanVoucher);
      if(!sendCommand(script)){
        return false;
      }
      script = ":if ($dtl>0) do={ :set tdtl [(dtl+DATA_LIMIT_HERE*1048576)] } else { :set tdtl [(DATA_LIMIT_HERE*1048576)] }; /ip hotspot user set limit-bytes-total=$tdtl VOUCHER_HERE";
      script.replace("VOUCHER_HERE", cleanVoucher);
      script.replace("DATA_LIMIT_HERE", String(currentDataLimit));
      if(!sendCommand(script)){
        return false;
      }
    }

    // Read the credited time back instead of trusting the write. Every check
    // above can only prove the telnet exchange completed: when RouterOS refused
    // the very first command -- it declined to create the user, or the profile
    // named in the script does not exist -- the writes afterwards silently did
    // nothing, the customer had coins in the slot against an empty voucher, and
    // useVoucher() still answered status:true. A positive number can only have
    // come from the router's own output, so this check has no false-positive
    // direction. The substring error scan used elsewhere does: a vendor name
    // containing a word like "cannot" would trip it on every single top up.
    return voucherCredited(cleanVoucher);

}

// Ask the router how much time a voucher actually holds. :put is the only way
// to get a value back out of a telnet session; see replyLineAfter() for why the
// last match is the one to read. False means "not credited", and the caller
// treats it that way.
bool voucherCredited(String voucher){
  tc.clearReply();
  String script = ":put (\"JFC=\" . [:tonum [/ip hotspot user get [find name=";
  script += voucher;
  script += "] limit-uptime]])";
  if(!sendCommand(script)){
    return false;
  }
  String payload = tc.replyLineAfter("JFC=");
  if(payload.length() == 0){
    Serial.println("RouterOS did not report the credited time back");
    return false;
  }
  int credited = payload.toInt();
  if(credited <= 0){
    Serial.println("The voucher still has no time after the credit");
    return false;
  }
  return true;
}

bool sendCommand(String script){
   Serial.println(script);
   // ponytail: JuanFiTelnetClient refuses anything that does not fit its send
   // buffer, and a stalled router now returns false instead of hanging. Both
   // used to be invisible here because the return value was thrown away, so an
   // over-long credit script or a dead router looked exactly like success: the
   // customer paid, the coins were counted, and no RouterOS command ever ran.
   // Screen the length here too, so the log says which of the two went wrong.
   if(script.length() + 2 >= TELNET_MAX_COMMAND){
     Serial.print("RouterOS command too long, not sent (");
     Serial.print(script.length());
     Serial.print(" of ");
     Serial.print(TELNET_MAX_COMMAND);
     Serial.println(" bytes)");
     return false;
   }
int scriptLength = script.length() + 1;
    char command [scriptLength];
    script.toCharArray(command, scriptLength);
    if(!tc.sendCommand(command)){
      Serial.println("RouterOS command was not acknowledged");
      return false;
    }
    return true;
 }

// RouterOS error text, matched against the reply the telnet client now keeps.
// This is a substring list rather than a parser: a match is possible when a
// harmless word collides, but the only caller in this firmware treats a match
// as "did not happen" and leaves the customer's voucher alone, so guessing
// wrong costs a refused merge and never a destroyed code.
bool routerReportedError(){
  static const char* markers[] = {
    "no such item", "invalid value", "unknown parameter", "syntax error",
    "failure", "cannot", "out of range", "not enough memory", "trap",
  };
  const int markerCount = (int)(sizeof(markers) / sizeof(markers[0]));
  for(int i = 0; i < markerCount; i++){
    if(tc.replyContains(markers[i])){
      return true;
    }
  }
  return false;
}

// sendCommand() only proves the telnet exchange completed. It cannot tell a
// clean RouterOS write from a router that answered "no such item", because the
// reply used to be discarded. Use this where a wrong answer would leave the
// customer out of pocket: it returns false on transport failure AND on
// RouterOS error text.
bool sendCommandChecked(String script){
  tc.clearReply();
  if(!sendCommand(script)){
    return false;
  }
  if(routerReportedError()){
    Serial.println("RouterOS refused the command");
    return false;
  }
  return true;
}

void resetGlobalVariables(){
  currentActiveVoucher = "";
  timeToAdd = 0;
  totalCoin = 0;
  currentDataLimit = 0;
  currentRateProfile = "";
  // ponytail: this flag used to survive the reset, so a "new voucher" left over
  // from an earlier purchase decided the validity rule for the next customer.
  isNewVoucher = false;
}

void disableCoinSlot(){
  coinSlotActive = false;
  digitalWrite(COIN_SET_PIN, LOW);
  digitalWrite(INSERT_COIN_LED, evaluateTriggerOutput(TURN_OFF));
}

int calculateAddTime(){
  int totalTime = 0;
  currentValidity = 0;
  currentDataLimit = 0;
  int remainingCoin = totalCoin;
  int highestPrice = 0;
  while(remainingCoin > 0){
    int candidatePrice = 0;
    int candidateIndex = -1;
    for(int i=0;i<ratesCount;i++){
      if(rates[i].price <= remainingCoin){
        if(candidatePrice < rates[i].price){
          candidatePrice = rates[i].price;
          candidateIndex = i;
        }
      }
    }
    if( candidateIndex != -1 ){
      //when extend time and voucher validity option is  First Validity + extend time, add the extend time instead of validity
      if((!isNewVoucher) && VOUCHER_VALIDITY_OPTION == 1){
        currentValidity += rates[candidateIndex].minutes;
      }else{
        currentValidity += rates[candidateIndex].validity;
      }

      //get the highest user rate profile from the rates
      if(highestPrice < rates[candidateIndex].price){
          highestPrice = rates[candidateIndex].price;
          if(rates[candidateIndex].profileName != ""){
            currentRateProfile = rates[candidateIndex].profileName;
          }
      }

      currentDataLimit += rates[candidateIndex].dataLimit;
      
      totalTime += rates[candidateIndex].minutes;
      remainingCoin -= rates[candidateIndex].price;
    }else{
      break;
    }
  }
  return totalTime * 60;
}

const char * COLUMN_DELIMETER = "#";
const char * ROW_DELIMETER = "|";

void populateSystemConfiguration(){

  //detect if backup is exists
  int backupLength = eeGetInt(BACKUP_CONFIG_LENGTH_INDEX);
  if(backupLength > 0){
    Serial.print("Backup data found ");
    Serial.println(backupLength);
    String backupData = eeReadString(BACKUP_CONFIG_LENGTH_INDEX+5, backupLength);
    // no payload echo: the backup carries the router and admin credentials
    handleFileWrite("/admin/config/system.data", backupData);
    eeWriteInt(BACKUP_CONFIG_LENGTH_INDEX, 0);
    Serial.print("Backup data restored!, restarting....");
    ESP.restart();
    return;
  }

  Serial.println("Loading system configuration");
  String data = readFile("/admin/config/system.data");
  // ponytail: this printed the whole file, which carries the MikroTik password
  // and the admin credentials, onto the serial log. Log the shape only.
  Serial.print("Loaded system.data, ");
  Serial.print(data.length());
  Serial.println(" bytes");
  int rowSize = 30;
  String rows[rowSize];
  int rowCount = split(rows, rowSize, data, '|');
  if(rowCount < rowSize){
    // A short file used to leave rows[26..29] holding empty strings, so the
    // static IP branch wrote 0.0.0.0 into the address bytes -- and a zero field
    // for any pin lands on a strapping pin.
    Serial.print("Warning: system.data has ");
    Serial.print(rowCount);
    Serial.print(" of ");
    Serial.println(rowSize);
    Serial.println("fields, the rest fall back to defaults");
  }
  String ip[4];
  split(ip, 4, rows[3], '.');
  
  mikrotikRouterIp[0] = ip[0].toInt();
  mikrotikRouterIp[1] = ip[1].toInt();
  mikrotikRouterIp[2] = ip[2].toInt();
  mikrotikRouterIp[3] = ip[3].toInt();
  vendorName = sanitizeRouterOsComment(rows[0]);
  ssid = rows[1];
  password = rows[2];
  user = rows[4];
  pwd = rows[5];
  // clamp the window: 0 seconds made every session expire on arrival, and the
  // value is stored in milliseconds so it has to stay well inside an int
  int waitSec = rows[6].toInt();
  if(waitSec < 10){
    if(rows[6].toInt() != 0){
      Serial.println("Coin wait time too short, clamped to 10 seconds");
    }
    waitSec = 10;
  }
  if(waitSec > 3600){
    Serial.println("Coin wait time too long, clamped to 3600 seconds");
    waitSec = 3600;
  }
  MAX_WAIT_COIN_SEC = waitSec * 1000;
  ADMIN_USER = rows[7];
  ADMIN_PW = rows[8];
  adminAuth = base64::encode(ADMIN_USER+":"+ADMIN_PW);
  COINSLOT_BAN_COUNT = rows[9].toInt();
  COINSLOT_BAN_MINUTES = rows[10].toInt();
  COIN_SELECTOR_PIN = rows[11].toInt();
  COIN_SET_PIN = rows[12].toInt();
  SYSTEM_READY_LED = rows[13].toInt();
  INSERT_COIN_LED = rows[14].toInt();
  INSERT_COIN_BTN_PIN = rows[16].toInt();
  CHECK_INTERNET_CONNECTION = rows[17].toInt();
  VOUCHER_PREFIX = sanitizeRouterOsToken(rows[18]);
  MARQUEE_MESSAGE = rows[19];
  SETUP_FINISH = rows[20].toInt();
  VOUCHER_LOGIN_OPTION = rows[21].toInt();
  VOUCHER_PROFILE = sanitizeRouterOsToken(rows[22]);
  VOUCHER_VALIDITY_OPTION = rows[23].toInt();
  LED_TRIGGER_TYPE = rows[24].toInt();
  IP_ADDRESS_MODE = rows[25].toInt();
  hardwareConfigUsable = pinsAreUsable();
  
  if(IP_ADDRESS_MODE == 1 && rowCount > 29){
    String localIpAddress[4];
    split(localIpAddress, 4, rows[26], '.');
   
    local_IP[0] = localIpAddress[0].toInt();
    local_IP[1] = localIpAddress[1].toInt();
    local_IP[2] = localIpAddress[2].toInt();
    local_IP[3] = localIpAddress[3].toInt();

    String gatewayIpAddress[4];
    split(gatewayIpAddress, 4, rows[27], '.');
   
    gateway[0] = gatewayIpAddress[0].toInt();
    gateway[1] = gatewayIpAddress[1].toInt();
    gateway[2] = gatewayIpAddress[2].toInt();
    gateway[3] = gatewayIpAddress[3].toInt();

    String subnetAddress[4];
    split(subnetAddress, 4, rows[28], '.');
   
    subnet[0] = subnetAddress[0].toInt();
    subnet[1] = subnetAddress[1].toInt();
    subnet[2] = subnetAddress[2].toInt();
    subnet[3] = subnetAddress[3].toInt();

    String primaryDNSAddress[4];
    split(primaryDNSAddress, 4, rows[29], '.');
   
    primaryDNS[0] = primaryDNSAddress[0].toInt();
    primaryDNS[1] = primaryDNSAddress[1].toInt();
    primaryDNS[2] = primaryDNSAddress[2].toInt();
    primaryDNS[3] = primaryDNSAddress[3].toInt();
  }
 

}


// ponytail: capacity is explicit because the callers pass fixed stack arrays
// and the data is admin-controlled. Without the bound, one extra delimiter
// writes past the array and smashes the stack (no stack protector on lx106).
int split(String rows[], int capacity, String data, char delimeter){
  int count = 0;
  String elementData = "";
  for(int i=0;i<data.length();i++){
      if(data.charAt(i) != delimeter){
        elementData.concat(data.charAt(i));
      }else{
        if(count < capacity) rows[count] = elementData;
        elementData = "";
        count++;
      }
  }
  if(elementData != ""){
     if(count < capacity) rows[count] = elementData;
     count++;
  }
  return count;
}


void populateRates(){

  Serial.println("Loading promo rates");
  String data = readFile("/admin/config/rates.data");
  Serial.print("Loaded rates.data, ");
  Serial.print(data.length());
  Serial.println(" bytes");
  const int MAX_RATE_ROWS = 100;
  String rows[MAX_RATE_ROWS];
  int parsedCount = split(rows, MAX_RATE_ROWS, data, '|');
  if(parsedCount > MAX_RATE_ROWS){
    Serial.println("rates.data has more rows than the rate table holds, extra rows ignored");
  }
  // split() keeps counting delimiters past the capacity it was given, so the
  // count can exceed the array. Only the rows it actually stored are readable.
  int usableCount = parsedCount < MAX_RATE_ROWS ? parsedCount : MAX_RATE_ROWS;

  ratesCount = 0;
  for(int i=0;i<usableCount;i++){
    String column[6];
    split(column, 6, rows[i], '#' );
    // both the local row copy and the global rates[] are capped at 100, so the
    // loop must not run off the end of either when the file is oversized
    rates[ratesCount].rateName = column[0];
    rates[ratesCount].price = column[1].toInt();
    rates[ratesCount].minutes = (column[2]).toInt();
    rates[ratesCount].validity = (column[3]).toInt();
    rates[ratesCount].dataLimit = (column[4]).toInt();
    rates[ratesCount].profileName = sanitizeRouterOsToken(column[5]);
    ratesCount++;
  }
  
}

unsigned long coinWaiting = 0;

// Proves the telnet session still works by round-tripping a command that cannot
// change anything. ":put" with an empty-ish value writes to the log at worst;
// it never touches the hotspot table. Returns false if the exchange did not
// complete, which is the only reliable signal that a socket claiming to be
// connected has actually died.
bool probeTelnetLink(){
  // ":global jfprobe" then a read of it: two short commands, both harmless.
  if(!sendCommand(":global jfprobe")){
    return false;
  }
  if(!sendCommand(":set jfprobe [:tonum \"1\"]")){
    return false;
  }
  return true;
}

void loop () {
   if(networkConnected){
    unsigned long currentMilis = millis();

   //handling for disconnection of AP
   if (!client.connected()) {
      handleSystemAbnormal();
      server.handleClient();
      return;
    }

    // ponytail: client.connected() stayed true for tens of seconds to minutes
    // after the router rebooted or dropped the telnet service, so the coin slot
    // kept arming and checkIfSystemIsAvailable() kept reporting "available".
    // Every credit then failed silently after the customer had paid. Probe the
    // session periodically and treat a failed exchange as a dead link.
    if(mikrotekConnectionSuccess && timeHasPassed(lastTelnetProbe + TELNET_PROBE_INTERVAL, currentMilis)){
      lastTelnetProbe = currentMilis;
      if(!probeTelnetLink()){
        Serial.println("Telnet probe failed, treating the router link as down");
        telnetProbeFailed = true;
        mikrotekConnectionSuccess = false;
        handleSystemAbnormal();
        server.handleClient();
        return;
      }
      if(telnetProbeFailed){
        telnetProbeFailed = false;
        Serial.println("Telnet probe recovered");
      }
    }

      int insertCoinButton = digitalRead(INSERT_COIN_BTN_PIN);
      if(insertCoinButton == LOW){
          if(!manualVoucher){
            if(welcomePrinted){
              bool result = activateManualVoucherPurchase();
              if(!result){
                //when no internet available, return back to normal to try later
                lastSaleTime = millis();
                thankyou_cooldown = 5000;
                welcomePrinted = false;
                return;  
              }
            }else{
              if(timeToAdd == 0){
                //clear thank you message after button press
                thankyou_cooldown = 0;
                targetMilis = currentMilis;
                delay(1000);
              }
            }
          }else{
            //make coinslot expired when button is pressed
            targetMilis = currentMilis;
          }
      }
       
    //insert coin logic
    if(acceptCoin){
      if(!timeHasPassed(targetMilis, currentMilis)){
          coinExpired = false;
          //wait for the coin to insert
          if(coinsChange > 0){
            // 700ms settle window so a coin is not counted before it lands
            if(coinWaiting == 0){
              coinWaiting = currentMilis + 700;
            }

            if(coinWaiting > currentMilis){
              goto coin_settled;
            }

            coinWaiting = 0;
            processCoin = coin;
            coin -= processCoin;
            Serial.print("Coin inserted: ");
            Serial.println(processCoin);
            coinsChange = 0;
            acceptCoin = false;

            //if manual voucher mode
            if(manualVoucher){
              totalCoin += processCoin;
              timeToAdd = calculateAddTime();
              activateCoinSlot(false);
            }
          }
          // ponytail: goto target for the 700ms coin settle window above.
          // It used to point at a block that picked which LCD message to draw;
          // with the display gone there is nothing to draw, so it is a no-op.
          // Kept deliberately -- removing the goto would process the coin
          // before the window closes. Needs a bench test before removal.
          coin_settled: ;
        }else{
        disableCoinSlot();
        acceptCoin = false;
        coinExpired = true;
        manualVoucher = false;
        timeToAdd = calculateAddTime();
        //Auto add time no need to use voucher
        if(timeToAdd > 0 ) {
          clearAttemptToCoinSlot();
          Serial.print("Coin insert waiting expired, Auto using the voucher ");
          Serial.println(currentActiveVoucher);
          // same honesty rule as useVoucher(): no client is listening on this
          // path, so a failure cannot be reported to anyone. Log it, refuse to
          // bank the sale, and take the router link down so the next request
          // re-authenticates before it takes another coin.
          bool credited = true;
          if(isNewVoucher){
            credited = registerNewVoucher(currentActiveVoucher);
          }
          if(credited){
            credited = addTimeToVoucher(currentActiveVoucher, timeToAdd);
          }
          if(credited){
            updateStatistic();
          }else{
            Serial.println("Auto credit failed, the router did not accept the command");
            mikrotekConnectionSuccess = false;
            telnetProbeFailed = true;
          }
        }else{
          addAttemptToCoinslot();
        }
        resetGlobalVariables();
      }
    }else{
      //if coinslot is disable
      //print welcome again after x seconds after thank you message
      if(timeHasPassed(targetMilis, currentMilis) && timeHasPassed(lastSaleTime + thankyou_cooldown, currentMilis)){
        welcomePrinted = true;
      }
    }
  }else{
    unsigned long currentMilis = millis();
    if(SETUP_FINISH == 1){
      //when setup is already finish and cannnot connect, wait for 10 mins to setup and will auto restart after that
      //this is to cater slow boot AP
      if(currentMilis >= 600000){
        ESP.restart();
      }
    }
     dnsServer.processNextRequest();
  }
  
  server.handleClient();
  MDNS.update();
}

void handleSystemAbnormal(){
    Serial.println("AP disconnected!!!!!!!!!!!!!!!");
    mikrotekConnectionSuccess = false;
    digitalWrite(INSERT_COIN_LED, evaluateTriggerOutput(TURN_OFF));
    digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_OFF));
    //Reconnect, re-running the telnet login rather than only restarting. loginMirotik()
    //no longer claims success it did not get, so a router that is merely rebooting
    //used to take the whole unit down with it. Keep serving the web UI while retrying,
    //and only reboot the ESP as the last resort.
    unsigned long startedAt = millis();
    while(!timeHasPassed(startedAt + 30000UL, millis())){
      server.handleClient();
      loginMirotik();
      if(mikrotekConnectionSuccess){
        Serial.println("Mikrotik login recovered");
        digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_ON));
        return;
      }
      delay(2000);
    }
    Serial.println("Mikrotik still unreachable, restarting");
    ESP.restart();
}

bool activateManualVoucherPurchase(){
  bool hasInternetConnection = true;
  if(CHECK_INTERNET_CONNECTION == 1){
        hasInternetConnection = hasInternetConnect();
  }
  if(!hasInternetConnection){
    return false;
  }

  // no respond flag: this runs from the button handler inside loop(), not from a
  // request, and there is no client to send a body to
  if(!checkIfSystemIsAvailable(false)){
      return false;
  }

  currentMacAttempt = currentMacAddress;
  currentValidity = 0;
  resetGlobalVariables();
  // must follow the reset, otherwise the flag this buys us is wiped again
  isNewVoucher = true;
  activateCoinSlot(true);
  currentActiveVoucher = generateVoucher();
  manualVoucher = true;
  //show 30 sec the voucher code
  thankyou_cooldown = 30000;
  return true;
}

void handleGenerateVouchers(){

  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }  
  int amount = server.arg("amt").toInt();
  int qty = server.arg("qty").toInt();
  int addToSales = server.arg("sales").toInt();
  String prefix = sanitizeRouterOsToken(server.arg("pfx"));
  // The code space is only 9000 wide, so a runaway qty would loop forever and
  // hand out duplicates. A duplicate voucher is not a cosmetic problem: the
  // second customer topping up with it extends the first customer's session.
  if(qty < 1 || qty > 500 || amount < 1){
    server.send(400, "text/plain", "invalid quantity or amount");
    return;
  }
  if(prefix.length() == 0){
    prefix = sanitizeRouterOsToken(VOUCHER_PREFIX);
  }
  // calculateAddTime() and the voucher calls below write totalCoin, timeToAdd,
  // currentValidity, currentDataLimit, currentRateProfile and isNewVoucher as
  // globals. Those are the live state of whoever happens to be paying right now,
  // so stash them and put them back: an admin generating stock vouchers must not
  // zero out a customer's pending top up.
  int sessionTotalCoin = totalCoin;
  int sessionTimeToAdd = timeToAdd;
  int sessionValidity = currentValidity;
  int sessionDataLimit = currentDataLimit;
  String sessionRateProfile = currentRateProfile;
  bool sessionIsNewVoucher = isNewVoucher;
  // every voucher built here is brand new, and the flag has to be set outside the
  // loop because registerNewVoucher/addTimeToVoucher read it as a global
  isNewVoucher = true;
  String voucherGenerated = "";
  int generated = 0;
  String issued = "";
  for(int i=0;i<qty;i++){
    String voucher = "";
    bool duplicate = true;
    for(int attempt=0; attempt<64 && duplicate; attempt++){
      String candidate = prefix+String(random(1000, 9999));
      if(issued.indexOf(candidate) == -1){
        voucher = candidate;
        duplicate = false;
      }
    }
    if(duplicate){
      // code space exhausted for this batch
      break;
    }
    issued += "#" + voucher;
    totalCoin = amount;
    timeToAdd = calculateAddTime();
    // An amount below the cheapest rate buys nothing. addTimeToVoucher() would
    // add 0m, leave the voucher at 00:00:00 and fail the credit read-back, but
    // the reason is the operator's amount, not the router, so say so.
    if(timeToAdd <= 0){
      issued.remove(issued.length() - voucher.length() - 1);
      Serial.print("Stopped: that amount buys no time at the current rates: ");
      Serial.println(amount);
      break;
    }
    // bulk generation is pre-paid stock, so a voucher the router refused to
    // create must not be counted as issued or handed back to the operator as
    // though it were sellable
    if(!registerNewVoucher(voucher)){
      issued.remove(issued.length() - voucher.length() - 1);
      Serial.print("Stopped: the router refused voucher ");
      Serial.println(voucher);
      mikrotekConnectionSuccess = false;
      telnetProbeFailed = true;
      break;
    }
    if(!addTimeToVoucher(voucher, timeToAdd)){
      issued.remove(issued.length() - voucher.length() - 1);
      Serial.print("Stopped: the router refused to credit voucher ");
      Serial.println(voucher);
      mikrotekConnectionSuccess = false;
      telnetProbeFailed = true;
      break;
    }
    if(addToSales == 1){
      updateStatistic();
    }
    generated++;
    if(generated > 1){
      voucherGenerated += "#";
    }
    voucherGenerated += voucher;
  }
  if(generated < qty){
    Serial.print("Voucher generation stopped early, issued ");
    Serial.print(generated);
    Serial.print(" of ");
    Serial.println(qty);
  }
  int minutesAdded = timeToAdd;
  totalCoin = sessionTotalCoin;
  timeToAdd = sessionTimeToAdd;
  currentValidity = sessionValidity;
  currentDataLimit = sessionDataLimit;
  currentRateProfile = sessionRateProfile;
  isNewVoucher = sessionIsNewVoucher;
  String returnData = vendorName +"|"+amount+"|"+String(minutesAdded)+"|"+ voucherGenerated;
  server.send(200, "text/plain", returnData);
}


int evaluateTriggerOutput(int state){
  if(LED_TRIGGER_TYPE == 1){
    if(state == TURN_ON){
        return HIGH;
    }else{
        return LOW;
    }
  }else{
    if(state == TURN_ON){
        return LOW;
    }else{
        return HIGH;
    }
  }
}
