// JS-facing API of the FT8 decoder (WebAssembly). The decode loop and the callsign hash table follow
// ft8_lib's demo/decode_ft8.c (MIT, Kārlis Goba); audio arrives from JS as 12 kHz float blocks.
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#include <ft8/decode.h>
#include <ft8/message.h>
#include <common/monitor.h>

#define EXPORT __attribute__((visibility("default")))
enum { kMin_score = 10, kMax_candidates = 140, kLDPC_iterations = 25, kMax_decoded = 50, kTextLen = 40 };

typedef struct { float snr, dt, freq; int32_t score; char text[kTextLen]; } result_t;

static monitor_t mon;
static float block[4096];
static result_t results[kMax_decoded];

// ---- callsign hash table (as in the demo) ----
#define HT 256
static struct { char callsign[12]; uint32_t hash; } ht[HT];
static void ht_cleanup(uint8_t max_age) {
  for (int i = 0; i < HT; ++i) if (ht[i].callsign[0]) {
    uint8_t age = (uint8_t)(ht[i].hash >> 24);
    if (age > max_age) { ht[i].callsign[0] = 0; ht[i].hash = 0; }
    else ht[i].hash = (((uint32_t)age + 1u) << 24) | (ht[i].hash & 0x3FFFFFu);
  }
}
static void ht_add(const char *callsign, uint32_t hash) {
  uint16_t h10 = (hash >> 12) & 0x3FFu; int i = (h10 * 23) % HT;
  while (ht[i].callsign[0]) {
    if (((ht[i].hash & 0x3FFFFFu) == hash) && !strcmp(ht[i].callsign, callsign)) { ht[i].hash &= 0x3FFFFFu; return; }
    i = (i + 1) % HT;
  }
  strncpy(ht[i].callsign, callsign, 11); ht[i].callsign[11] = 0; ht[i].hash = hash;
}
static bool ht_lookup(ftx_callsign_hash_type_t type, uint32_t hash, char *callsign) {
  uint8_t shift = type == FTX_CALLSIGN_HASH_10_BITS ? 12 : type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0;
  uint16_t h10 = (hash >> (12 - shift)) & 0x3FFu; int i = (h10 * 23) % HT;
  while (ht[i].callsign[0]) {
    if (((ht[i].hash & 0x3FFFFFu) >> shift) == hash) { strcpy(callsign, ht[i].callsign); return true; }
    i = (i + 1) % HT;
  }
  callsign[0] = 0; return false;
}
static ftx_callsign_hash_interface_t hash_if = { .lookup_hash = ht_lookup, .save_hash = ht_add };

EXPORT void ft8_init(void) {
  monitor_config_t cfg = { .f_min = 200, .f_max = 3000, .sample_rate = 12000, .time_osr = 2, .freq_osr = 2, .protocol = FTX_PROTOCOL_FT8 };
  memset(ht, 0, sizeof ht);
  monitor_init(&mon, &cfg);
}
EXPORT float *ft8_block_ptr(void) { return block; }
EXPORT int ft8_block_size(void) { return mon.block_size; }
EXPORT void ft8_process(void) { if (mon.wf.num_blocks < mon.wf.max_blocks) monitor_process(&mon, block); }
EXPORT int ft8_blocks(void) { return mon.wf.num_blocks; }
EXPORT void ft8_reset(void) { monitor_reset(&mon); }
EXPORT result_t *ft8_results_ptr(void) { return results; }
EXPORT int ft8_result_size(void) { return sizeof(result_t); }

// decode the accumulated slot; returns the number of messages written to results[]
EXPORT int ft8_decode(void) {
  const ftx_waterfall_t *wf = &mon.wf;
  ftx_candidate_t cand_list[kMax_candidates];
  int n_cand = ftx_find_candidates(wf, kMax_candidates, cand_list, kMin_score);
  ftx_message_t decoded[kMax_decoded];
  ftx_message_t *slot[kMax_decoded];
  for (int i = 0; i < kMax_decoded; ++i) slot[i] = 0;
  int n = 0;
  for (int c = 0; c < n_cand && n < kMax_decoded; ++c) {
    const ftx_candidate_t *cand = &cand_list[c];
    ftx_message_t msg; ftx_decode_status_t st;
    if (!ftx_decode_candidate(wf, cand, kLDPC_iterations, &msg, &st)) continue;
    int i = msg.hash % kMax_decoded; bool dup = false;
    while (slot[i]) {
      if (slot[i]->hash == msg.hash && !memcmp(slot[i]->payload, msg.payload, sizeof msg.payload)) { dup = true; break; }
      i = (i + 1) % kMax_decoded;
    }
    if (dup) continue;
    memcpy(&decoded[i], &msg, sizeof msg); slot[i] = &decoded[i];
    result_t *r = &results[n++];
    ftx_message_offsets_t offs;
    if (ftx_message_decode(&msg, &hash_if, r->text, &offs) != FTX_MESSAGE_RC_OK) strcpy(r->text, "?");
    r->freq = (mon.min_bin + cand->freq_offset + (float)cand->freq_sub / wf->freq_osr) / mon.symbol_period;
    r->dt = (cand->time_offset + (float)cand->time_sub / wf->time_osr) * mon.symbol_period;
    r->score = cand->score;
    r->snr = cand->score * 0.5f - 24.0f; // rough, as in the demo (score * 0.5) shifted to a WSJT-X-like scale
  }
  ht_cleanup(10);
  return n;
}
