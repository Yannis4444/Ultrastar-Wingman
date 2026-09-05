#include "ReaderBus.h"

#include <Arduino.h>
#include <SPI.h>
#include <driver/gpio.h>

namespace {

// Version bytes of the chips these breakouts are built from: MFRC522 v0.0/v1.0/v2.0, the
// FM17522 clones, and the counterfeit that answers 0x12.
bool knownVersion(uint8_t version) {
    switch (version) {
    case 0x88:
    case 0x89:
    case 0x90:
    case 0x91:
    case 0x92:
    case 0xB2:
    case 0x12:
        return true;
    default:
        return false;
    }
}

} // namespace

void ReaderBus::begin() {
    // Every chip select high before the first transfer: the library only drives a pin once
    // its own reader is initialised, and an RC522 whose select line still floats answers
    // over the reader being probed.
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        pinMode(kReaderCsPins[i], OUTPUT);
        digitalWrite(kReaderCsPins[i], HIGH);
    }

    SPI.begin(kPinSck, kPinMiso, kPinMosi);
    // Nothing drives MISO while every reader is deselected, and a floating line reads noise.
    // The pull-up makes an empty chip select answer 0xFF, which the probe knows as "not
    // wired" instead of calling it a fault. It has to be the IDF call and it has to come
    // after SPI.begin: Arduino's pinMode() hands the pin back to the peripheral manager,
    // which detaches MISO from the SPI unit and ties every read to 0x00, and SPI.begin sets
    // the pin to a plain INPUT itself, so a pull-up asked for earlier is gone again.
    gpio_set_pull_mode(static_cast<gpio_num_t>(kPinMiso), GPIO_PULLUP_ONLY);

    for (uint8_t i = 0; i < kReaderCount; ++i) {
        Reader &reader = readers_[i];
        // PCD_Init resets the chip in software (there is no RST wire) and sets the timer and
        // the antenna. On an empty chip select it gives up after its own retries.
        reader.mfrc.PCD_Init();
        // The RC522 needs a few milliseconds after a reset before VersionReg reads true.
        delay(kResetSettleMs);

        const uint8_t first =
            reader.driver.PCD_ReadRegister(MFRC522Driver::PCD_Register::VersionReg);
        const uint8_t second =
            reader.driver.PCD_ReadRegister(MFRC522Driver::PCD_Register::VersionReg);
        versions_[i] = first;

        if (first != second) {
            // Two readings that disagree come before everything else: cheap clones do not
            // release MISO when deselected, so a position answers the idle line once and its
            // neighbour's version the next time. That is a fault, not an empty position, and
            // the wizard's discovery step says which reader it is.
            states_[i] = ReaderState::Fault;
        } else if (first == 0x00 || first == 0xFF) {
            states_[i] = ReaderState::NotWired;
            // §4's example: an unwired position reports "00", whatever the idle line read.
            versions_[i] = 0x00;
        } else if (!knownVersion(first)) {
            states_[i] = ReaderState::Fault;
        } else {
            states_[i] = ReaderState::Wired;
        }
    }
}

uint8_t ReaderBus::version(uint8_t reader) const {
    return reader < kReaderCount ? versions_[reader] : 0;
}

ReaderState ReaderBus::state(uint8_t reader) const {
    return reader < kReaderCount ? states_[reader] : ReaderState::NotWired;
}

uint8_t ReaderBus::wiredCount() const {
    uint8_t count = 0;
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        if (states_[i] == ReaderState::Wired) {
            ++count;
        }
    }
    return count;
}

PollResult ReaderBus::poll(uint8_t reader, uint8_t *uid, uint8_t &uidLength) {
    uidLength = 0;
    if (reader >= kReaderCount || states_[reader] != ReaderState::Wired) {
        return PollResult::None;
    }

    Reader &r = readers_[reader];
    // The library resets these before every wake-up; a card left in another state would
    // otherwise answer at the wrong baud rate.
    r.driver.PCD_WriteRegister(MFRC522Driver::PCD_Register::TxModeReg, 0x00);
    r.driver.PCD_WriteRegister(MFRC522Driver::PCD_Register::RxModeReg, 0x00);
    r.driver.PCD_WriteRegister(MFRC522Driver::PCD_Register::ModWidthReg, 0x26);

    // WUPA, not REQA: the card was halted after the last read and only a wake-up brings it
    // back — which is what makes a card lying still answer every 100 ms.
    uint8_t atqa[2] = {};
    uint8_t atqaSize = sizeof(atqa);
    const MFRC522::StatusCode wakeup = r.mfrc.PICC_WakeupA(atqa, &atqaSize);
    if (wakeup == MFRC522::StatusCode::STATUS_COLLISION) {
        return PollResult::Collision;
    }
    if (wakeup != MFRC522::StatusCode::STATUS_OK) {
        return PollResult::None;
    }

    if (r.mfrc.PICC_Select(&r.mfrc.uid) != MFRC522::StatusCode::STATUS_OK) {
        // Something answered the wake-up but no single uid came out of it. Something is
        // lying on the reader, which is all the tracker needs to keep the card it knows.
        r.mfrc.PICC_HaltA();
        return PollResult::Collision;
    }

    uidLength = r.mfrc.uid.size;
    for (uint8_t i = 0; i < uidLength && i < sizeof(r.mfrc.uid.uidByte); ++i) {
        uid[i] = r.mfrc.uid.uidByte[i];
    }
    r.mfrc.PICC_HaltA();
    return PollResult::Uid;
}
