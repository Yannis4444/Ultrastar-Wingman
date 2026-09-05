// MFRC522v2 glue: the boot probe and one poll of one reader. Everything the tracker decides
// from this lives in CardTracker; this file only talks to the chips.
#pragma once

#include <MFRC522DriverPinSimple.h>
#include <MFRC522DriverSPI.h>
#include <MFRC522v2.h>

#include "CardTracker.h"
#include "Report.h"
#include "pins.h"

// One reader's objects. The library keeps references to the pin and the driver, so a Reader
// is built in place and never copied.
struct Reader {
    explicit Reader(uint8_t csPin) : pin(csPin), driver(pin), mfrc(driver) {}
    Reader(const Reader &) = delete;
    Reader &operator=(const Reader &) = delete;

    MFRC522DriverPinSimple pin;
    MFRC522DriverSPI driver;
    MFRC522 mfrc;
};

class ReaderBus {
  public:
    // SPI.begin plus the probe of every position; call once from setup().
    void begin();

    // The VersionReg byte of the last probe, as it went into the report.
    uint8_t version(uint8_t reader) const;
    ReaderState state(uint8_t reader) const;
    bool wired(uint8_t reader) const { return state(reader) == ReaderState::Wired; }
    // How many positions the probe found, which is what the round-robin divides its tick by.
    uint8_t wiredCount() const;

    // One WUPA / select / halt round on a wired reader. `uid` takes the bytes read and
    // `uidLength` their count when the result is PollResult::Uid.
    PollResult poll(uint8_t reader, uint8_t *uid, uint8_t &uidLength);

  private:
    Reader readers_[kReaderCount] = {Reader(kReaderCsPins[0]), Reader(kReaderCsPins[1]),
                                     Reader(kReaderCsPins[2]), Reader(kReaderCsPins[3]),
                                     Reader(kReaderCsPins[4]), Reader(kReaderCsPins[5])};
    uint8_t versions_[kReaderCount] = {};
    ReaderState states_[kReaderCount] = {};
};
