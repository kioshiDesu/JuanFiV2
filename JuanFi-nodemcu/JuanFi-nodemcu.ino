/*waitTime
 * 
 * JuanFiV2
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
 * Supported ESP32 Lanbase and ESP8266 
 * 
 * Based on JuanFi by Ivan Julius Alayan, maintained as JuanFiV2 by kioshiDesu
 * 
*/

//increase always when publishing a new version for tracking
#define CURRENT_VERSION "2.4"

#ifdef ESP32
  #include <TelnetClient.h>
  #include "lan_definition.h"
  #include <SPIFFS.h>
  #include <Update.h>
  #include <WiFi.h>
#else
  #include <ESP8266TelnetClient.h>
  #include <ESP8266WiFi.h>
  #include <ESP8266WebServer.h>
  #include <ESP8266HTTPClient.h>
  #include <ESP8266mDNS.h>
  #include <DNSServer.h>
  #include <Arduino.h>
  #include <flash_hal.h>
#endif

#include <EEPROM.h>
#include "FS.h"
#include <base64.h>

int TURN_OFF = 0;
int TURN_ON = 1;

volatile int coin = 0;
volatile int processCoin = 0;
volatile int totalCoin = 0;
boolean isNewVoucher = false;
volatile int coinsChange = 0;
String currentActiveVoucher = "";
String currentMacAttempt = "";
int timeToAdd = 0;
bool coinSlotActive = false;
bool acceptCoin = false;
unsigned long targetMilis = 0;
bool coinExpired = false;
bool mikrotekConnectionSuccess = false;
String currentMacAddress = "";
String currentIpAddress = "";
#ifdef ESP32
  String HARDWARE_TYPE = "ESP32";
#else
  String HARDWARE_TYPE = "ESP8266";
#endif

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
  long unlockTime;
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
int CHECK_INTERNET_CONNECTION = 0;
int LED_TRIGGER_TYPE = 1;
int IP_ADDRESS_MODE = 0;
int VOUCHER_LOGIN_OPTION = 0;
int VOUCHER_VALIDITY_OPTION = 0;
String VOUCHER_PROFILE = "default";
String VOUCHER_PREFIX = "1FI";

int MAX_WAIT_COIN_SEC = 30000;
int COINSLOT_BAN_COUNT = 0;
int COINSLOT_BAN_MINUTES = 0;
int AUTO_RESTART_MINUTES = 0;
unsigned long lastAutoRestartCheck = 0;
unsigned long lastDhcpCheck = 0;
int SETUP_FINISH = 0;

//put here your raspi ip address, and login details
IPAddress mikrotikRouterIp (10, 0, 0, 1);
String user = "pisonet";
String pwd = "abc123";
String ssid     = "MikrofffffTik-36DA2B";
String password = "";
String adminAuth = "";
String vendorName = "";

// static address setting (defaults: vendo .254/16, hotspot/router .1)
IPAddress local_IP(10, 0, 0, 254);
IPAddress gateway(10, 0, 0, 1);
IPAddress subnet(255, 255, 0, 0);
IPAddress primaryDNS(10, 0, 0, 1); // hotspot router

IPAddress apIP(172, 217, 28, 1);

#ifdef ESP32
  EthernetWebServer server(80);
  EthernetClient client;
  EthernetClient client2;
  telnetClient tc(client);
#else
  WiFiClient client2;
  WiFiClient client;
  ESP8266telnetClient tc(client);
  ESP8266WebServer server(80);
  const byte DNS_PORT = 53;
  DNSServer dnsServer;
#endif

const int WIFI_CONNECT_TIMEOUT = 360000;
const int WIFI_CONNECT_DELAY = 500;

bool networkConnected = false;
bool cableNotConnected = false;

int lastSaleTime = 0;
int thankyou_cooldown = 5000;

void setup () { 
                                
  Serial.begin (115200);
  randomSeed(analogRead(A0) + micros()); // seed voucher randomness
  EEPROM.begin(512);
  if(!SPIFFS.begin()){
    Serial.println("An Error has occurred while mounting SPIFFS");
    return;
  }  
  populateSystemConfiguration(); 
  
  pinMode(COIN_SELECTOR_PIN, INPUT_PULLUP);
  pinMode(INSERT_COIN_LED, OUTPUT);
  pinMode(SYSTEM_READY_LED, OUTPUT);
  pinMode(COIN_SET_PIN, OUTPUT);

  #ifdef ESP32
    initializeLANSetup();
  #else
    // We start by connecting to a WiFi network
    WiFi.mode(WIFI_STA);
    //for static ip configuration
    if(IP_ADDRESS_MODE == 1){
      Serial.print("using static ip address");
      Serial.println(local_IP);
      WiFi.config(local_IP, gateway, subnet, primaryDNS);  
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
  #endif
  
  
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
   
    #ifdef ESP32
      //nothing
    #else
      if (MDNS.begin("esp8266")) {
        Serial.println("MDNS responder started");
      }
    #endif

    server.on("/topUp", topUp);
    server.on("/checkCoin", checkCoin);
    server.on("/useVoucher", useVoucher);
    server.on("/health", handleHealth);
    server.on("/getRates", handleUserGetRates);
    server.on("/cancelTopUp", handleCancelTopUp);
    server.on("/testInsertCoin", testInsertCoin);
    server.onNotFound(handleNotFound);
    
  }else{
    #ifdef ESP32
      //nothing
    #else
      //Soft AP setup
      WiFi.mode(WIFI_AP);
      WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
      WiFi.softAP("JuanFiV2 Setup");
      //if DNSServer is started with "*" for domain name, it will reply with
      //provided IP to all DNS request
      dnsServer.start(DNS_PORT, "*", apIP);
    #endif

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
  server.on("/admin/api/issuedUsers", handleAdminIssuedUsers);
  server.on("/admin/api/kickUser", handleAdminKickUser);
  server.on("/admin/api/restartSystem", handleAdminRestart);
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
boolean isFileSystem = true;

void handleFileUploadRequest(){
    if(!isAuthorized()){
       handleNotAuthorize();
       return;
    }
    if (Update.hasError()) {
      //when esp32 has sometimes error of not enough space, but actually its uploaded some part succesfully so we will just return success
      if(isFileSystem && HARDWARE_TYPE == "ESP32"){
        server.send(200, F("text/html"), "Upload done, with warnings");
        server.client().stop();
        ESP.restart();
      }else{
        server.send(200, F("text/html"), "Upload has error");
      }
    }
    else {
        #ifdef ESP32
          //nothing not avaiable at esp32
        #else
         server.client().setNoDelay(true);
        #endif
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
            isFileSystem = true;
            backupSystemConfig();
            #ifdef ESP32
              if (!Update.begin(SPIFFS.totalBytes(), U_SPIFFS)) {
                  Serial.println("Upload filesystem start failed");
                  hasUploadError = true;
              }
            #else
               size_t fsSize = ((size_t) &_FS_end - (size_t) &_FS_start);
               close_all_fs();
               if (!Update.begin(fsSize, U_FS)){//start with max available size
                 Serial.println("Upload filesystem start failed");
                 hasUploadError = true;
               }
            #endif
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
            Serial.printf("Update Success: %u\nRebooting...\n", upload.totalSize);
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
  eeWriteInt(BACKUP_CONFIG_LENGTH_INDEX, len);
  eeWriteString(BACKUP_CONFIG_LENGTH_INDEX+5, data);
}

#ifdef ESP32
void initializeLANSetup(){
  delay(3000);
  Serial.print("\nStarting ESP32_FS_EthernetWebServer on " + String(BOARD_TYPE));
  Serial.println(" with " + String(SHIELD_TYPE));
  Serial.println(ETHERNET_WEBSERVER_VERSION);

  ET_LOGWARN(F("=========== USE_ETHERNET ==========="));

  ET_LOGWARN(F("Default SPI pinout:"));
  ET_LOGWARN1(F("MOSI:"), MOSI);
  ET_LOGWARN1(F("MISO:"), MISO);
  ET_LOGWARN1(F("SCK:"),  SCK);
  ET_LOGWARN1(F("SS:"),   SS);
  ET_LOGWARN(F("========================="));

  #ifndef USE_THIS_SS_PIN
    #define USE_THIS_SS_PIN   5   //22    // For ESP32
  #endif

  ET_LOGWARN1(F("ESP32 setCsPin:"), USE_THIS_SS_PIN);
  Ethernet.init (USE_THIS_SS_PIN);
  // start the ethernet connection and the server:
  Serial.println("Ethernet initialized...");

  //Use the ESP32 wifi mac address for our LAN
  byte mac[6];
  WiFi.macAddress(mac);

  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("Cable not detected!!!");
    networkConnected = false;
    cableNotConnected = true;
  }else if(IP_ADDRESS_MODE == 1){ //for static LAN IP
    Ethernet.begin(mac, local_IP, primaryDNS, gateway, subnet);
    networkConnected = true;
  }else if(Ethernet.begin(mac) != 0){ //for dhcp LAN IP
    networkConnected = true;
  }else{
    networkConnected = false;
    Serial.println("Cannot connect to dhcp server");
    Ethernet.begin(mac, apIP, apIP, apIP, IPAddress(255, 255, 255, 0));
  }
  // Just info to know how to connect correctly
  Serial.println(F("========================="));
  Serial.println(F("Currently Used SPI pinout:"));
  Serial.print(F("MOSI:"));
  Serial.println(MOSI);
  Serial.print(F("MISO:"));
  Serial.println(MISO);
  Serial.print(F("SCK:"));
  Serial.println(SCK);
  Serial.print(F("SS:"));
  Serial.println(SS);
  Serial.println("=========================");
  
  Serial.print(F("Connected! IP address: "));
  Serial.println(Ethernet.localIP());

  currentIpAddress = Ethernet.localIP().toString().c_str();
  //Use the ESP32 wifi mac address for our LAN
  currentMacAddress = WiFi.macAddress();
}
#endif

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
    Serial.println(mikrotikRouterIp);
    delay(3000);
  
    mikrotekConnectionSuccess = tc.login(mikrotikRouterIp, user.c_str(), pwd.c_str());
    if(mikrotekConnectionSuccess){
      Serial.println("Login to mikrotek router success");
    }else{
      Serial.println("Warning, failed to login to mikrotek router, coins will not be accepted until login succeeds");
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
  
  if(!checkIfSystemIsAvailable()){
      return;
  }
  String voucher = server.arg("voucher");
  if(!validateVoucher(voucher)){
      return;
  }
  if(!isSessionIpAllowed()){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coinslot.busy"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
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
  if(authLockoutUntil != 0 && (long)(millis() - authLockoutUntil) < 0){
    return false;
  }
  String auth = server.header("Authorization");
  String expectedAuth = "Basic "+adminAuth;
  if(auth == expectedAuth){
    authFailCount = 0;
    return true;
  }
  authFailCount++;
  if(authFailCount >= 5){
    authFailCount = 0;
    authLockoutUntil = millis() + 60000;
  }
  return false;
}

bool isSessionIpAllowed(){
  if(sessionIp == "") return true;
  return server.client().remoteIP().toString() == sessionIp;
}

void handleNotAuthorize(){
  server.sendHeader("WWW-Authenticate", "Basic realm=\"Secure\"");
  server.send(401, "text/html", "<html>Authentication failed</html>");
}

bool handleFileRead(String path){  // send the right file to the client (if it exists)
  Serial.println("handleFileRead: " + path);
  if(path.indexOf("..") >= 0){
    Serial.println("\tBlocked path traversal attempt");
    return false;
  }
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

bool checkIfSystemIsAvailable(){
  if(!mikrotekConnectionSuccess){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coin.slot.notavailable"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return false;
  }else{
    return true;
  }
}

#ifdef ESP32
  char internetServerAddress[] = "ifconfig.me";  // server address
  int internetCheckPort = 80;
  EthernetHttpClient  httpClient(client2, internetServerAddress, internetCheckPort);
#else
  String INTERNET_CHECK_URL = "http://ifconfig.me";
#endif

bool hasInternetConnect(){

    #ifdef ESP32
      httpClient.get("/");
      int statusCode = httpClient.responseStatusCode();
      String response = httpClient.responseBody();
      Serial.print("Status code: ");
      Serial.println(statusCode);
      Serial.print("Response: ");
      Serial.println(response);
      return true;
    #else
      HTTPClient http;  
  
      http.begin(client2, INTERNET_CHECK_URL); //HTTP
      http.addHeader("User-Agent", "curl/7.55.1");
      int httpCode = http.GET();
      if (httpCode > 0) {
        const String& payload = http.getString();
        Serial.println("received payload:\n<<");
        Serial.println(payload);
        Serial.println(">>");
        Serial.println("Internet connection detected!");
        http.end();
        return true;
      }else{
        Serial.println("Internet connection not detected!");
        Serial.printf("[HTTP] GET... failed, error: %s\n", http.errorToString(httpCode).c_str());
        http.end();
        return false;
      }
    #endif
}

void addAttemptToCoinslot(){
  if(COINSLOT_BAN_COUNT > 0){
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
          long curMil = millis();
          attempted[currentMacIndex].unlockTime = curMil + (COINSLOT_BAN_MINUTES * 60000);
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

  if(!checkIfSystemIsAvailable()){
      return;
  }
  
  String voucher = server.arg("voucher");
  if(!validateVoucher(voucher)){
      return;
  }
  if(!isSessionIpAllowed()){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coinslot.busy"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
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
    activateCoinSlot();
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 6));
  }else{
    char * keys[] = {"status", "errorCode", "remainTime", "timeAdded", "totalCoin", "waitTime", "validity", "data"};
    char remainTimeStr[20];
    long remain = targetMilis - millis();
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

  if(!checkIfSystemIsAvailable()){
      return;
  }

  String voucher = server.arg("voucher");
  if(!validateVoucher(voucher)){
      return;
  }
  if(!isSessionIpAllowed()){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coinslot.busy"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
  disableCoinSlot();
  if(timeToAdd > 0 ){
    clearAttemptToCoinSlot();
    //if(isNewVoucher){
    if(!isExtendTime){
      registerNewVoucher(voucher);
    }
    //}
    updateStatistic();
    addTimeToVoucher(voucher, timeToAdd);
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
  lastSaleTime = millis(); // LCD removed; keep thank-you cooldown timing
  resetGlobalVariables();
  setupCORSPolicy();
  acceptCoin = false;
  server.send(200, "application/json", toJson(keys, values, 4));
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

bool isExtendTime = false; // true when portal extends an existing online voucher
String sessionIp = ""; // client IP bound at topUp, enforced on coin endpoints
int authFailCount = 0;
unsigned long authLockoutUntil = 0;

void topUp() {
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

  if(!checkIfSystemIsAvailable()){
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
  //reject new coin sessions while the previous voucher is still displayed
  if(lastSaleTime > 0 && (millis() - (unsigned long)lastSaleTime) < (unsigned long)thankyou_cooldown){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "coinslot.busy"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
  currentMacAttempt = macAdd;
  String voucher = server.arg("voucher");
  if(voucher != "" && !isValidVoucherCode(voucher)){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "invalid.voucher"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
   if(currentActiveVoucher != "" && !validateVoucher(voucher)){
      return;
  }
  
  currentValidity = 0; 
  if(voucher == ""){
    voucher = generateVoucher();
    isNewVoucher = true;
  }else{
    if(isNewVoucher && voucher == currentActiveVoucher){
      isNewVoucher = true;
    }else{
      isNewVoucher = false;
    }
  }
  char * keys[] = {"status", "voucher"};
  char voucherChar[32];
  voucher.toCharArray(voucherChar, sizeof(voucherChar));
  char * values[] = {"true", voucherChar};
  if(voucher != currentActiveVoucher){
    resetGlobalVariables();
    activateCoinSlot();
    currentActiveVoucher = voucher;
  }
  //extend-time flow: portal sends extendTime=1 with an existing online voucher;
  //skip hotspot-user creation later, only add time to the existing user
  isExtendTime = (server.arg("extendTime") == "1" && server.arg("voucher") != "");
  sessionIp = server.client().remoteIP().toString();
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
          long curMil = millis();
          if( attempted[i].unlockTime > 0 && attempted[i].unlockTime <= curMil){
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

void activateCoinSlot(){
  digitalWrite(COIN_SET_PIN, HIGH);
  delay(200);
  processCoin = 0;
  acceptCoin = true;
  coinSlotActive = true;
  targetMilis = millis() + MAX_WAIT_COIN_SEC;
  digitalWrite(INSERT_COIN_LED, evaluateTriggerOutput(TURN_ON));
}

String escapeJson(String val){
  val.replace("\\", "\\\\");
  val.replace("\"", "\\\"");
  return val;
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
    json += escapeJson(String(values[i]));
    json += "\" ";
   
  }
  json += "}";
  return json;
}

String generateVoucherWithPrefix(String prefix){
  //no easily-confused chars (0/O, 1/I/L) so codes are easy to type
  const char charset[] = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  String voucher = prefix;
  for(int attempt = 0; attempt < 5; attempt++){
    voucher = prefix;
    for(int i = 0; i < 5; i++){
      voucher += charset[random(sizeof(charset) - 1)];
    }
    if(readFile("/issued.data").indexOf(voucher) < 0){
      break;
    }
  }
  return voucher;
}

String generateVoucher(){
  return generateVoucherWithPrefix(VOUCHER_PREFIX);
}

void registerNewVoucher(String voucher){
  String addCoinScript = "/ip hotspot user add name=";
  addCoinScript += voucher;
  addCoinScript += " limit-uptime=0 comment=0";
  if(VOUCHER_LOGIN_OPTION == 1){
    addCoinScript += " password=";
    addCoinScript += voucher;
  }
  if(VOUCHER_PROFILE != "" && VOUCHER_PROFILE != "default"){
    addCoinScript += " profile=";
    addCoinScript += VOUCHER_PROFILE;   
  }
  sendCommand(addCoinScript);
  logIssuedVoucher(voucher);
}

void addTimeToVoucher(String voucher, int secondsToAdd){

    String script = ":global lpt; :global nlu; :set lpt [/ip hotspot user get ";
    script += voucher;
    script += " limit-uptime]; ";
    sendCommand(script);
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
    script += vendorName;
    script += "\" ";
    
    if(currentRateProfile != ""){
      script += "profile=" ;
      script += currentRateProfile;
      script += " ";
    }
    script += voucher;
    script += "; " ;
    sendCommand(script);
    
    if(currentDataLimit != 0){
      String script = ":global tdtl; :global dtl [/ip hotspot user get VOUCHER_HERE  limit-bytes-total];";
      script.replace("VOUCHER_HERE", voucher);
      sendCommand(script);
      script = ":if ($dtl>0) do={ :set tdtl [(dtl+DATA_LIMIT_HERE*1048576)] } else { :set tdtl [(DATA_LIMIT_HERE*1048576)] }; /ip hotspot user set limit-bytes-total=$tdtl VOUCHER_HERE";
      script.replace("VOUCHER_HERE", voucher);
      script.replace("DATA_LIMIT_HERE", String(currentDataLimit));
      sendCommand(script);
    }
    
}

void sendCommand(String script){
   Serial.println(script);
   if(script.length() > 400){
     Serial.println("Command too long, refused");
     return;
   }
   char command[401];
   script.toCharArray(command, sizeof(command));
   tc.sendCommand(command);
}

void resetGlobalVariables(){
  currentActiveVoucher = "";
  sessionIp = "";
  isExtendTime = false;
  timeToAdd = 0;
  totalCoin = 0;
  currentDataLimit = 0;
  currentRateProfile = "";
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
    Serial.println(backupData);
    handleFileWrite("/admin/config/system.data", backupData);
    eeWriteInt(BACKUP_CONFIG_LENGTH_INDEX, 0);
    Serial.print("Backup data restored!, restarting....");
    ESP.restart();
    return;
  }

  Serial.println("Loading system configuration");
  String data = readFile("/admin/config/system.data");
  int rowSize = 31;
  String rows[rowSize];
  int fieldCount = split(rows, rowSize, data, '|');
  if(fieldCount != rowSize){
    Serial.println("Warning, system.data field count mismatch, missing fields use defaults");
  }
  String ip[4];
  split(ip, 4, rows[3], '.');
 
  mikrotikRouterIp[0] = ip[0].toInt();
  mikrotikRouterIp[1] = ip[1].toInt();
  mikrotikRouterIp[2] = ip[2].toInt();
  mikrotikRouterIp[3] = ip[3].toInt();
  vendorName = rows[0];
  ssid = rows[1];
  password = rows[2];
  user = rows[4];
  pwd = rows[5];
  MAX_WAIT_COIN_SEC = rows[6].toInt() * 1000;
  ADMIN_USER = rows[7];
  ADMIN_PW = rows[8];
  adminAuth = base64::encode(ADMIN_USER+":"+ADMIN_PW);
  COINSLOT_BAN_COUNT = rows[9].toInt();
  COINSLOT_BAN_MINUTES = rows[10].toInt();
  COIN_SELECTOR_PIN = rows[11].toInt();
  COIN_SET_PIN = rows[12].toInt();
  SYSTEM_READY_LED = rows[13].toInt();
  INSERT_COIN_LED = rows[14].toInt();
  CHECK_INTERNET_CONNECTION = rows[17].toInt();
  VOUCHER_PREFIX = rows[18];
  SETUP_FINISH = rows[20].toInt();
  VOUCHER_LOGIN_OPTION = rows[21].toInt();
  VOUCHER_PROFILE = rows[22];
  VOUCHER_VALIDITY_OPTION = rows[23].toInt();
  LED_TRIGGER_TYPE = rows[24].toInt();
  IP_ADDRESS_MODE = rows[25].toInt();
  
  if(IP_ADDRESS_MODE == 1){
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
  AUTO_RESTART_MINUTES = rows[30].toInt();


}

int split(String rows[], int cap, String data, char delimeter){
  int count = 0;
  String elementData = "";
  for(int i=0;i<data.length();i++){
      if(data.charAt(i) != delimeter){
        elementData.concat(data.charAt(i));
      }else{
        if(count >= cap){
          break;
        }
        rows[count] = elementData;
        elementData = "";
        count++;
      }
  }
  if(elementData != "" && count < cap){
     rows[count] = elementData;
     count++;
  }
  return count;
}

void populateRates(){

  Serial.println("Loading promo rates");
  String data = readFile("/admin/config/rates.data");
  Serial.print("Data: ");
  Serial.println(data);
  String rows[100];
  ratesCount = split(rows, 100, data, '|' );

  for(int i=0;i<ratesCount;i++){
    Serial.print("Data: ");
    Serial.println(rows[i]);
    String column[6];
    split(column, 6, rows[i], '#' );
    rates[i].rateName = column[0];
    rates[i].price = column[1].toInt();
    rates[i].minutes = (column[2]).toInt();
    rates[i].validity = (column[3]).toInt();
    rates[i].dataLimit = (column[4]).toInt();
    rates[i].profileName = column[5];
  }
  
}

int coinWaiting = 0;
long lastLinkStatusCheck = 0;

void loop () {
   if(networkConnected){
    unsigned long currentMilis = millis();

   //handling for disconnection of AP
   bool linkStatusOff = false;

   #ifdef ESP32
   //check ethernet status every 2 sec
   if(currentMilis > lastLinkStatusCheck + 2000){
    linkStatusOff = Ethernet.linkStatus() == LinkOFF;
    lastLinkStatusCheck = currentMilis;
   }
   #endif
   
   if (!client.connected() || linkStatusOff) {
      handleSystemAbnormal();
      server.handleClient();
      return;
   }

    //insert coin logic
    if(acceptCoin){
      if((targetMilis > currentMilis)){
          coinExpired = false;
          //wait for the coin to insert
          if(coinsChange > 0){
            //coin debounce handled by coin-waiting logic below
            if(coinWaiting == 0){
              coinWaiting = currentMilis + 700;
            }

            if(coinWaiting > currentMilis){
              goto printing;
            }

            coinWaiting = 0;
            noInterrupts();
            processCoin = coin;
            coin = 0;
            interrupts();
            Serial.print("Coin inserted: ");
            Serial.println(processCoin);
            coinsChange = 0;
            acceptCoin = false;
          }
          printing:
          ; // LCD removed: no status display; label kept for coin-debounce goto
      }else{
        disableCoinSlot();
        acceptCoin = false;
        coinExpired = true;
        timeToAdd = calculateAddTime();
        //Auto add time no need to use voucher
        if(timeToAdd > 0 ) {
          clearAttemptToCoinSlot();
          Serial.print("Coin insert waiting expired, Auto using the voucher ");
          Serial.print(currentActiveVoucher);
          if(isNewVoucher){
            registerNewVoucher(currentActiveVoucher);
          }
          updateStatistic();
          addTimeToVoucher(currentActiveVoucher, timeToAdd);
          lastSaleTime = millis(); // LCD removed; keep thank-you cooldown timing
        }else{
          addAttemptToCoinslot();
        }
        resetGlobalVariables();
      }
    }
    //DHCP auto renewal: re-request/verify the lease instead of restarting
    if(IP_ADDRESS_MODE == 0 && (millis() - lastDhcpCheck) >= 300000UL){
      lastDhcpCheck = millis();
      #ifdef ESP32
        Ethernet.maintain();
      #else
        if(WiFi.status() != WL_CONNECTED){
          Serial.println("WiFi lost, reconnecting without restart...");
          WiFi.reconnect();
        }
      #endif
    }
    //auto restart after configured minutes, only when the vendo is idle
    if(AUTO_RESTART_MINUTES > 0 && (millis() - lastAutoRestartCheck) >= (unsigned long)AUTO_RESTART_MINUTES * 60000UL){
      lastAutoRestartCheck = millis();
      if(!acceptCoin && !coinSlotActive && currentActiveVoucher == ""){
        ESP.restart();
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
    #ifdef ESP32
      //nothing
    #else
     dnsServer.processNextRequest();
    #endif
  }
  
  server.handleClient();
  #ifdef ESP32
    //nothing
  #else
    MDNS.update();
  #endif
}

void handleSystemAbnormal(){
    Serial.println("AP disconnected!!!!!!!!!!!!!!!");
    mikrotekConnectionSuccess = false;
    digitalWrite(INSERT_COIN_LED, evaluateTriggerOutput(TURN_OFF));
    digitalWrite(SYSTEM_READY_LED, evaluateTriggerOutput(TURN_OFF));
    //Reconnect after 30 seconds
    delay(30000);
    ESP.restart();
}

void handleAdminRestart(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }
  setupCORSPolicy();
  //do not restart while the vendo is busy serving a customer
  if(acceptCoin || coinSlotActive || currentActiveVoucher != ""){
    char * keys[] = {"status", "detail"};
    char * values[] = {"busy", "vendo is busy, try again later"};
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
  char * keys[] = {"status", "detail"};
  char * values[] = {"restarting", "system will restart now"};
  server.send(200, "application/json", toJson(keys, values, 2));
  delay(500);
  ESP.restart();
}

bool isValidVoucherCode(String code){
  if(code.length() == 0 || code.length() > 24) return false;
  for(int i = 0; i < code.length(); i++){
    char c = code.charAt(i);
    if(!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' && c != '_') return false;
  }
  return true;
}

bool isValidKickTarget(String name){
  if(name.length() == 0 || name.length() > 32) return false;
  for(int i = 0; i < name.length(); i++){
    char c = name.charAt(i);
    if(!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' && c != '_') return false;
  }
  return true;
}

void logIssuedVoucher(String voucher){
  //latest 20 vendo-issued vouchers; live online status is not readable via telnet
  String data = readFile("/issued.data");
  String users[21];
  int count = 0;
  int start = 0;
  for(int i = 0; i <= data.length() && count < 21; i++){
    if(i == data.length() || data.charAt(i) == '#'){
      String item = data.substring(start, i);
      if(item != "" && item != voucher){
        users[count] = item;
        count++;
      }
      start = i + 1;
    }
  }
  String out = voucher;
  for(int i = 0; i < count && i < 19; i++){
    out += "#" + users[i];
  }
  File file = SPIFFS.open("/issued.data", "w");
  if(file){
    file.print(out);
    file.close();
  }
}

void removeIssuedVoucher(String voucher){
  String data = readFile("/issued.data");
  String out = "";
  int start = 0;
  for(int i = 0; i <= data.length(); i++){
    if(i == data.length() || data.charAt(i) == '#'){
      String item = data.substring(start, i);
      if(item != "" && item != voucher){
        if(out != "") out += "#";
        out += item;
      }
      start = i + 1;
    }
  }
  File file = SPIFFS.open("/issued.data", "w");
  if(file){
    file.print(out);
    file.close();
  }
}

void handleAdminIssuedUsers(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }
  //readFile returns "" when the file does not exist yet (no hang)
  server.send(200, "text/plain", readFile("/issued.data"));
}

void handleAdminKickUser(){
  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }
  String target = server.arg("user");
  if(!isValidKickTarget(target)){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "invalid.user"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
  sendCommand(String("/ip hotspot user remove [find name=") + target + "]");
  sendCommand(String("/ip hotspot active remove [find user=") + target + "]");
  sendCommand(String("/ip hotspot cookie remove [find user=") + target + "]");
  sendCommand(String("/system scheduler remove [find name=") + target + "]");
  removeIssuedVoucher(target);
  char targetChar[33];
  target.toCharArray(targetChar, sizeof(targetChar));
  char * keys[] = {"status", "user"};
  char * values[] = {"true", targetChar};
  setupCORSPolicy();
  server.send(200, "application/json", toJson(keys, values, 2));
}

void handleGenerateVouchers(){

  if(!isAuthorized()){
     handleNotAuthorize();
     return;
  }  
  int amount = server.arg("amt").toInt();
  int qty = server.arg("qty").toInt();
  int addToSales = server.arg("sales").toInt();
  String prefix = server.arg("pfx");
  bool prefixOk = prefix.length() > 0 && prefix.length() <= 5;
  for(int i = 0; prefixOk && i < prefix.length(); i++){
    char c = prefix.charAt(i);
    if(!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9')) prefixOk = false;
  }
  if(!prefixOk || qty <= 0 || qty > 20){
    char * keys[] = {"status", "errorCode"};
    char * values[] = {"false", "invalid.request"};
    setupCORSPolicy();
    server.send(200, "application/json", toJson(keys, values, 2));
    return;
  }
  String voucherGenerated = "";
  for(int i=0;i<qty;i++){
    String voucher = generateVoucherWithPrefix(prefix);
    totalCoin = amount;
    timeToAdd = calculateAddTime();
    registerNewVoucher(voucher);
    if(addToSales == 1){
      updateStatistic();
    }
    addTimeToVoucher(voucher, timeToAdd);
    if(i > 0){
      voucherGenerated += "#";
    }
    voucherGenerated += voucher;
  }
  String returnData = vendorName +"|"+amount+"|"+String(timeToAdd)+"|"+ voucherGenerated;
  server.send(200, "text/pain", returnData);
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
