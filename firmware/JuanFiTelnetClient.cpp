/*
 * JuanFiTelnetClient -- see JuanFiTelnetClient.h for why this fork exists.
 * Fork of ESP8266-Telnet-Client (c) Alessio Villa, MIT licensed, "Feel free to
 * modify this function if you want a different output!" per the original file.
 */

#include "JuanFiTelnetClient.h"


JuanFiTelnetClient::JuanFiTelnetClient(WiFiClient& client){
    this->client = &client;
}

bool JuanFiTelnetClient::login(IPAddress serverIpAddress, const char* username, const char* password, uint8_t port){

    this->print('\n');
    this->print('\r');

    DEBUG_PRINT(F("login|connecting..."));
    if(this->client->connect(serverIpAddress, port)){
        DEBUG_PRINT(F("login|connected!"));
        //here there will be the initial negotiation
        if(!listenUntil(':')){
            return false;
        }
        //listen();
        DEBUG_PRINT(F("login|sending username"));
        if (!this->send(username, false)) return false;
        // upstream dropped the return value here, so a router that never sends
        // the password prompt still cost us a full LISTEN_TOUT and then went on
        // to send a password to a session that was never established.
        if (!listenUntil(':')) return false;
        DEBUG_PRINT(F("login|sending password"));
        if (!this->send(password, false)) return false;

        #ifdef MT_VM
        //mikrotik router with demo license
        this->listenUntil('!');
        this->send("", false);
        #endif

        return this->waitPrompt();
        //listen();
        //return true;


    }
    else{
        DEBUG_PRINT(F("login|connection failed!"));
        return false;
    }
}

bool JuanFiTelnetClient::sendCommand(const char* cmd){

    if(!this->send(cmd)) return false;
    //negotiation until the server show the command prompt again
    if (strcmp(cmd, "exit") != 0){
        return this->waitPrompt();
    }
    else{
        this->disconnect();
        return true;
    }

}

void JuanFiTelnetClient::disconnect(){
    this->client->stop();
}

bool JuanFiTelnetClient::isConnected(){
    return this->client->connected();
}

bool JuanFiTelnetClient::send(const char* buf, bool waitEcho){

    // MAX_OUT_BUFFER_LENGTH is wider than a uint8_t now, and a truncated
    // l_size here would let a full-length command look short and slip past the
    // two length checks above.
    uint16_t l_size = strnlen(buf, MAX_OUT_BUFFER_LENGTH);
    if(l_size == MAX_OUT_BUFFER_LENGTH){
        DEBUG_PRINT(F("send|BAD INPUT"));
        return false;
    }

    char l_outBuffer[MAX_OUT_BUFFER_LENGTH];
    strlcpy(l_outBuffer, buf, MAX_OUT_BUFFER_LENGTH);
    if(strlcat(l_outBuffer, "\r\n", MAX_OUT_BUFFER_LENGTH) >= MAX_OUT_BUFFER_LENGTH){
        DEBUG_PRINT(F("send|BAD INPUT"));
        return false;
    }

    l_size = strnlen(l_outBuffer, MAX_OUT_BUFFER_LENGTH);
    for (uint16_t i=0; i<l_size; ++i){
        if(l_outBuffer[i] > 0){
            this->client->write(l_outBuffer[i]);
            this->print(l_outBuffer[i]);
            if (waitEcho){
                // ponytail: upstream spun here forever waiting for the router
                // to echo one byte, with no timeout and no liveness check. One
                // router reboot and the unit is unrecoverable without a power
                // cycle. Bound it, and hand the failure back to the caller.
                if(!this->waitReadable(ECHO_TOUT)){
                    DEBUG_PRINT(F("send|ECHO TIMEOUT"));
                    return false;
                }
                this->client->read();
            }
        }
    }

    //this->print('\r');
    return true;
}

void JuanFiTelnetClient::negotiate(){

    byte verb, opt;
    byte outBuf[3] = {255, 0, 0};

    DEBUG_PRINT(F("negotiate|server:IAC"));
    verb = this->client->read ();
    if (verb == - 1) return;
    switch (verb) {
        case 255:
            //...no it isn't!
            DEBUG_PRINT(F("negotiate|server:IAC escape"));
            this->print(char (verb));
        break;
        case 251:
          //to a WILL statement...
            DEBUG_PRINT(F("negotiate|server:WILL"));
            // ponytail: these two reads used to block on a peer that had
            // already gone quiet. waitReadable() gives up instead.
            if(!this->waitReadable(PROMPT_REC_TOUT)) return;
            opt = this->client->read();
            if (opt == -1) break;
            DEBUG_PRINT(F("negotiate|server opt: "));
            DEBUG_PRINT(opt);
            //always answer DO!
            outBuf[1] = 253;
            outBuf[2] = opt;
            this->client->write(outBuf, 3);
            this->client->flush();
            DEBUG_PRINT(F("negotiate|client:IAC"));
            DEBUG_PRINT(F("negotiate|client:DO"));
        break;
        case 252:
          //to a WONT statement...
            DEBUG_PRINT(F("negotiate|server:WONT"));
        break;
        case 253:
          //to a DO request...
            DEBUG_PRINT(F("negotiate|server:DO"));
            if(!this->waitReadable(PROMPT_REC_TOUT)) return;
            opt = this->client->read();
            if (opt == -1) break;
            DEBUG_PRINT(F("negotiate:server opt: "));
            DEBUG_PRINT(opt);
            //alway answer WONT!
            outBuf[1] = 252;
            outBuf[2] = opt;
            this->client->write(outBuf, 3);
            this->client->flush();
            DEBUG_PRINT(F("negotiate:client:IAC"));
            DEBUG_PRINT(F("negotiate:client:WONT"));
        break;
        case 254:
          //to a DONT statement...
            DEBUG_PRINT(F("negotiate:server:DONT"));
        break;
    }

}

void JuanFiTelnetClient::listen(){

    if(!this->waitReadable(LISTEN_TOUT)) return;

    byte inByte;
    unsigned long startMillis = millis();

    while(1){
        if (client->available() > 0){
            startMillis = millis();
            inByte = this->client->read ();
            if (inByte <= 0){
                //DEBUG_PRINT(F("listen|what?"));
            }
            else if(inByte == 255){
                this->negotiate();
            }
            else{
                //is stuff to be displayed
                this->capture(char(inByte));
            }
        }
        else if (millis() - startMillis > LISTEN_TOUT){
            DEBUG_PRINT(F("listen|TIMEOUT!!!"));
            return;
        }
    }
}

bool JuanFiTelnetClient::listenUntil(char c){

    byte inByte;
    unsigned long startMillis;
    //listen incoming bytes untile one char in the array arrive
    // ponytail: this wait was the other unbounded one. Bound it.
    if(!this->waitReadable(LISTEN_TOUT)){
        DEBUG_PRINT(F("listenUntil|NOTHING TO READ"));
        return false;
    }
    startMillis = millis();
    do {
        if(this->client->available() > 0){
            inByte = this->client->read();
            if (inByte <= 0){
                //DEBUG_PRINT(F("listen|what?"));
            }
            else if(inByte == 255){
                this->negotiate();
            }
            else{
                //is stuff to be displayed
                this->capture(char(inByte));
            }
            if (char(inByte) == c){
                DEBUG_PRINT(F("listenUntil|TERMINATOR RECEIVED"));
                return true;
            }
        }
        else if (millis() - startMillis > LISTEN_TOUT){
            DEBUG_PRINT(F("listen|TIMEOUT!!!"));
            return false;
        }
    }while (1);

}

bool JuanFiTelnetClient::waitPrompt(){

    bool l_bLoop = false;
    unsigned long startMillis = millis();

    do
    {
        if (!this->listenUntil(m_promptChar)) return false;
        char l_lastByte = this->client->read();
        do
        {
            l_bLoop = this->client->available() > 0;
            if (l_bLoop){
                DEBUG_PRINT(F("waitPrompt|FALSE PROMPT DETECTED"));
                this->print('\r');
                //this->print('\n');
                break;
            }
        }while(millis()-startMillis < PROMPT_REC_TOUT);

    }while(l_bLoop);

    //this->print('\n');
    //this->print('\r');
    DEBUG_PRINT(F("waitPrompt|END"));
    return true;
}

bool JuanFiTelnetClient::waitReadable(unsigned long timeoutMs){
    unsigned long startMillis = millis();
    while (this->client->available() == 0){
        // A closed socket will never produce a byte, so do not spend the whole
        // timeout finding that out.
        if (!this->client->connected()) return false;
        if (millis() - startMillis > timeoutMs) return false;
        delay(1);
    }
    return true;
}

void JuanFiTelnetClient::print(char c){
    //edit this function if you want a different output!
    Serial.print(c);
}

void JuanFiTelnetClient::capture(char c){
    this->print(c);
    if(m_replyLen < REPLY_CAPTURE_LENGTH){
        m_reply[m_replyLen++] = c;
    }else{
        // Keep the window pinned to the tail of the reply. A long command echo
        // would otherwise push the :put read-back we came for straight out.
        m_replyTruncated = true;
        memmove(m_reply, m_reply + 1, REPLY_CAPTURE_LENGTH - 1);
        m_reply[REPLY_CAPTURE_LENGTH - 1] = c;
    }
}

void JuanFiTelnetClient::clearReply(){
    m_replyLen = 0;
    m_replyTruncated = false;
    m_reply[0] = '\0';
}

int JuanFiTelnetClient::replyIndexOf(const char* needle){
    if(m_replyLen == 0 || needle == NULL || *needle == '\0'){
        return -1;
    }
    size_t needleLen = strlen(needle);
    if(needleLen > m_replyLen){
        return -1;
    }
    for(uint16_t i = 0; i + needleLen <= m_replyLen; i++){
        if(strncmp(m_reply + i, needle, needleLen) == 0){
            return (int)i;
        }
    }
    return -1;
}

int JuanFiTelnetClient::replyLastIndexOf(const char* needle){
    if(m_replyLen == 0 || needle == NULL || *needle == '\0'){
        return -1;
    }
    size_t needleLen = strlen(needle);
    if(needleLen > m_replyLen){
        return -1;
    }
    int found = -1;
    for(uint16_t i = 0; i + needleLen <= m_replyLen; i++){
        if(strncmp(m_reply + i, needle, needleLen) == 0){
            found = (int)i;
        }
    }
    return found;
}

bool JuanFiTelnetClient::replyContains(const char* needle){
    return this->replyIndexOf(needle) >= 0;
}

String JuanFiTelnetClient::replyLineAfter(const char* needle){
    String out = "";
    int start = this->replyLastIndexOf(needle);
    if(start < 0){
        return out;
    }
    for(uint16_t i = (uint16_t)(start + strlen(needle)); i < m_replyLen; i++){
        char c = m_reply[i];
        if(c == '\r' || c == '\n'){
            break;
        }
        out += c;
    }
    return out;
}

void JuanFiTelnetClient::setPromptChar(char c){
    m_promptChar = c;
}
