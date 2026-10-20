// JS-facing API of the FT8 decoder (WebAssembly). The decode loop and the callsign hash table follow
// ft8_lib's demo/decode_ft8.c (MIT, Kārlis Goba); audio arrives from JS as 12 kHz float blocks.
//
// Multi-pass decoding with signal subtraction (the approach of WSJT-X's subtractft8): after each pass every newly
// decoded signal is re-encoded, its start time / frequency refined on a 200 Hz baseband copy, its GFSK waveform
// rebuilt, its slowly varying complex amplitude estimated (a one-symbol moving average of x * conj(ref)) and the
// signal subtracted from the audio; the next pass then finds weaker signals that were hidden under it.
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <math.h>
#include <ft8/decode.h>
#include <ft8/encode.h>
#include <ft8/message.h>
#include <ft8/constants.h>
#include <common/monitor.h>
#include <ft8/ldpc.h>
#include <ft8/crc.h>
#include <fft/kiss_fftr.h>

void ftx_candidate_llr(const ftx_waterfall_t *wf, const ftx_candidate_t *cand, float *log174); // ft8_lib patch

#define EXPORT __attribute__((visibility("default")))
enum { kMin_score = 10, kMax_candidates = 140, kLDPC_iterations = 25, kMax_decoded = 100, kTextLen = 40, kPasses = 3, kFine_min_score = 6 };
// fine-sync search: +-2.5 Hz in 0.25 Hz steps, +-100 ms in 5 ms steps around ft8_lib's estimate
enum { NDF = 21, NDT = 20 };
enum { FS = 12000, NSPS = 1920, NSYM = 79, NWAVE = NSYM * NSPS, NMAX = 15 * FS, DS = 60, FSD = FS / DS, NSPSD = NSPS / DS };

typedef struct { float snr, dt, freq; int32_t score; char text[kTextLen]; } result_t;

static monitor_t mon;
static float block[4096];
static float sig[NMAX];            // the slot's audio (12 kHz), modified by subtraction
static int nsig;                   // samples stored
static result_t results[kMax_decoded];
static ftx_message_t seen[kMax_decoded];
static int nseen;

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
  monitor_config_t cfg = { .f_min = 200, .f_max = 3000, .sample_rate = FS, .time_osr = 2, .freq_osr = 2, .protocol = FTX_PROTOCOL_FT8 };
  memset(ht, 0, sizeof ht);
  monitor_init(&mon, &cfg);
}
EXPORT float *ft8_block_ptr(void) { return block; }
EXPORT int ft8_block_size(void) { return mon.block_size; }
EXPORT void ft8_process(void) {
  int n = mon.block_size;
  if (nsig + n <= NMAX) { memcpy(sig + nsig, block, n * sizeof(float)); nsig += n; }
}
EXPORT int ft8_blocks(void) { return nsig / mon.block_size; }
EXPORT void ft8_reset(void) { nsig = 0; monitor_reset(&mon); }
EXPORT result_t *ft8_results_ptr(void) { return results; }
EXPORT int ft8_result_size(void) { return sizeof(result_t); }

// ---- subtraction ----
static float erf_(float x) { // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  float s = x < 0 ? -1 : 1; x = fabsf(x);
  float t = 1 / (1 + 0.3275911f * x);
  float y = 1 - (((((1.061405429f * t - 1.453152027f) * t) + 1.421413741f) * t - 0.284496736f) * t + 0.254829592f) * t * expf(-x * x);
  return s * y;
}
static float zr[3200], zi[3200];                     // 200 Hz baseband copy around the signal
static float rr[NWAVE], ri[NWAVE];                     // reference waveform e^{j phi(n)}
static double pr[NWAVE + 1], pim[NWAVE + 1];           // prefix sums of x * conj(ref)
static float dphi[NWAVE + 2 * NSPS], pulse[3 * NSPS];

static void subtract(const uint8_t *tones, float f, int n0) {
  // GFSK phase (as ft8_lib's synth_gfsk: BT = 2, dummy symbols at both ends)
  const float K = 5.336446f, bt = 2.0f, dphi_peak = 2 * M_PI / NSPS;
  for (int i = 0; i < 3 * NSPS; ++i) { float t = i / (float)NSPS - 1.5f; pulse[i] = (erf_(K * bt * (t + 0.5f)) - erf_(K * bt * (t - 0.5f))) / 2; }
  for (int i = 0; i < NWAVE + 2 * NSPS; ++i) dphi[i] = 2 * M_PI * f / FS;
  for (int s = 0; s < NSYM; ++s) for (int j = 0; j < 3 * NSPS; ++j) dphi[j + s * NSPS] += dphi_peak * tones[s] * pulse[j];
  for (int j = 0; j < 2 * NSPS; ++j) { dphi[j] += dphi_peak * pulse[j + NSPS] * tones[0]; dphi[j + NSYM * NSPS] += dphi_peak * pulse[j] * tones[NSYM - 1]; }
  double phi = 0;
  for (int k = 0; k < NWAVE; ++k) { rr[k] = (float)cos(phi); ri[k] = (float)sin(phi); phi = fmod(phi + dphi[k + NSPS], 2 * M_PI); }
  // complex amplitude: moving average (one symbol) of x * conj(ref); then x -= 2 Re(amp * ref)
  pr[0] = pim[0] = 0;
  for (int k = 0; k < NWAVE; ++k) {
    int n = n0 + k; float x = (n >= 0 && n < nsig) ? sig[n] : 0;
    pr[k + 1] = pr[k] + x * rr[k]; pim[k + 1] = pim[k] - x * ri[k];
  }
  const int H = NSPS / 2;
  for (int k = 0; k < NWAVE; ++k) {
    int n = n0 + k; if (n < 0 || n >= nsig) continue;
    int a = k - H < 0 ? 0 : k - H, b = k + H > NWAVE ? NWAVE : k + H;
    double cr = (pr[b] - pr[a]) / (b - a), ci = (pim[b] - pim[a]) / (b - a);
    sig[n] -= (float)(2 * (cr * rr[k] - ci * ri[k]));
  }
}

// ---- OSD (ordered-statistics decoding), as WSJT-X's osd174_91: when belief propagation leaves errors, take the
// 91 most reliable bits as the information set, re-encode, and try flipping one or two of the least reliable of them;
// the candidate codeword closest to the received soft bits (weighted by |LLR|) is accepted if its CRC checks.
typedef struct { uint64_t w[3]; } bits174;
static bits174 G[FTX_LDPC_K];                   // generator rows (systematic on columns 0..90)
static bool g_ready;
static inline int bget(const bits174 *b, int i) { return (b->w[i >> 6] >> (i & 63)) & 1; }
static inline void bset(bits174 *b, int i) { b->w[i >> 6] |= 1ull << (i & 63); }
static inline void bxor(bits174 *a, const bits174 *b) { a->w[0] ^= b->w[0]; a->w[1] ^= b->w[1]; a->w[2] ^= b->w[2]; }
static void g_init(void) {
  memset(G, 0, sizeof G);
  for (int j = 0; j < FTX_LDPC_K; ++j) {
    bset(&G[j], j);
    for (int i = 0; i < FTX_LDPC_M; ++i) if (kFTX_LDPC_generator[i][j >> 3] & (0x80 >> (j & 7))) bset(&G[j], FTX_LDPC_K + i);
  }
  g_ready = true;
}
static float weight_of(const bits174 *c, const bits174 *h, const float *rel, int *nerr) {
  float d = 0; int n = 0;
  for (int k = 0; k < 3; ++k) {
    uint64_t x = c->w[k] ^ h->w[k];
    while (x) { int b = __builtin_ctzll(x); d += rel[k * 64 + b]; n++; x &= x - 1; }
  }
  *nerr = n; return d;
}
static bool crc_ok(const bits174 *c, uint8_t payload[10], uint16_t *crc) {
  uint8_t a91[FTX_LDPC_K_BYTES] = { 0 };
  for (int i = 0; i < FTX_LDPC_K; ++i) if (bget(c, i)) a91[i >> 3] |= 0x80 >> (i & 7);
  uint16_t ext = ftx_extract_crc(a91);
  a91[9] &= 0xF8; a91[10] = 0;
  memcpy(payload, a91, 10);                     // 77 payload bits, CRC bits cleared (as ft8_lib's own decoder)
  *crc = ftx_compute_crc(a91, 96 - 14);
  return ext == *crc;
}
static bool osd_decode(const float *llr, ftx_message_t *msg) {
  if (!g_ready) g_init();
  static bits174 M[FTX_LDPC_K];
  float rel[FTX_LDPC_N]; int perm[FTX_LDPC_N];
  bits174 h = { { 0, 0, 0 } };
  for (int k = 0; k < FTX_LDPC_N; ++k) { rel[k] = fabsf(llr[k]); perm[k] = k; if (llr[k] > 0) bset(&h, k); }
  // sort positions by reliability (insertion sort, 174 items)
  for (int i = 1; i < FTX_LDPC_N; ++i) { int p = perm[i], j = i; while (j > 0 && rel[perm[j - 1]] < rel[p]) { perm[j] = perm[j - 1]; j--; } perm[j] = p; }
  memcpy(M, G, sizeof M);
  int piv[FTX_LDPC_K], rank = 0;
  for (int k = 0; k < FTX_LDPC_N && rank < FTX_LDPC_K; ++k) {
    int c = perm[k], r = rank;
    while (r < FTX_LDPC_K && !bget(&M[r], c)) r++;
    if (r == FTX_LDPC_K) continue;               // column dependent on the ones already chosen
    bits174 t = M[r]; M[r] = M[rank]; M[rank] = t;
    for (int i = 0; i < FTX_LDPC_K; ++i) if (i != rank && bget(&M[i], c)) bxor(&M[i], &M[rank]);
    piv[rank++] = c;
  }
  bits174 c0 = { { 0, 0, 0 } };
  for (int i = 0; i < FTX_LDPC_K; ++i) if (bget(&h, piv[i])) bxor(&c0, &M[i]);
  bits174 best = c0; int ne; float bd = weight_of(&c0, &h, rel, &ne);
  // order 1 over all information bits, order 2 among the 30 least reliable ones
  for (int i = 0; i < FTX_LDPC_K; ++i) {
    bits174 c1 = c0; bxor(&c1, &M[i]);
    float d = weight_of(&c1, &h, rel, &ne); if (d < bd) { bd = d; best = c1; }
    if (i >= FTX_LDPC_K - 30) for (int j = i + 1; j < FTX_LDPC_K; ++j) {
      bits174 c2 = c1; bxor(&c2, &M[j]);
      d = weight_of(&c2, &h, rel, &ne); if (d < bd) { bd = d; best = c2; }
    }
  }
  int nhard; weight_of(&best, &h, rel, &nhard);
  if (nhard > 40) return false;                  // too far from the received bits: likely a false decode
  uint16_t crc; uint8_t payload[10];
  if (!crc_ok(&best, payload, &crc)) return false;
  memcpy(msg->payload, payload, 10); msg->hash = crc;
  return true;
}

// ---- fine synchronisation on a 200 Hz baseband copy (as WSJT-X's ft8_downsample / sync8d) ----
// The waterfall's grid is coarse (80 ms, 3.125 Hz); demodulating there leaves strong signals with many bit errors.
// Each candidate is mixed down around its band, its start time (5 ms steps) and frequency (0.25 Hz steps) are
// refined on the Costas arrays, and the 8 tone magnitudes of every symbol are measured at that point.
static float twr[8][NDF][NSPSD], twi[8][NDF][NSPSD]; // tone phasors per frequency offset
static bool tw_ready;
static void tw_init(void) {
  for (int t = 0; t < 8; ++t) for (int d = 0; d < NDF; ++d) {
    double w = 2 * M_PI * ((t - 3.5) * 6.25 + (d - NDF / 2) * 0.25) / FSD;
    for (int m = 0; m < NSPSD; ++m) { twr[t][d][m] = (float)cos(w * m); twi[t][d][m] = (float)-sin(w * m); }
  }
  tw_ready = true;
}
// Baseband copy as WSJT-X's ft8_downsample: one real FFT of the whole slot per pass (0.0625 Hz bins), then for each
// candidate the bins within +-100 Hz of its band (tapered from +-50 Hz) go through a 3200-point inverse FFT,
// giving 3200 complex samples at 200 Hz with neighbouring signals properly filtered out.
enum { NFFT1 = 192000, NFFT2 = 3200 };
static kiss_fft_cpx X1[NFFT1 / 2 + 1], B2[NFFT2], Z2[NFFT2];
static kiss_fftr_cfg cfg1; static kiss_fft_cfg cfg2;
static float pad1[NFFT1];
static bool spec_valid;
static void spectrum(void) {
  if (!cfg1) { cfg1 = kiss_fftr_alloc(NFFT1, 0, 0, 0); cfg2 = kiss_fft_alloc(NFFT2, 1, 0, 0); }
  memset(pad1, 0, sizeof pad1); memcpy(pad1, sig, nsig * sizeof(float));
  kiss_fftr(cfg1, pad1, X1);
  spec_valid = true;
}
static void baseband(float fc) {
  if (!spec_valid) spectrum();
  const float df = (float)FS / NFFT1;           // 0.0625 Hz
  const int i0 = (int)(fc / df + 0.5f), half = NFFT2 / 2;
  for (int k = 0; k < NFFT2; ++k) { B2[k].r = B2[k].i = 0; }
  for (int k = -half; k < half; ++k) {
    int i = i0 + k; if (i < 0 || i > NFFT1 / 2) continue;
    float f = fabsf(k * df), w = f <= 50 ? 1 : f >= 100 ? 0 : 0.5f * (1 + cosf((float)M_PI * (f - 50) / 50));
    int b = (k + NFFT2) % NFFT2;
    B2[b].r = X1[i].r * w; B2[b].i = X1[i].i * w;
  }
  kiss_fft(cfg2, B2, Z2);
  for (int m = 0; m < NFFT2; ++m) { zr[m] = Z2[m].r; zi[m] = Z2[m].i; }
}
static inline float tone_pow(int mb, int t, int d) {
  float cr = 0, ci = 0;
  for (int m = 0; m < NSPSD; ++m) { float a = zr[mb + m], b = zi[mb + m]; cr += a * twr[t][d][m] - b * twi[t][d][m]; ci += a * twi[t][d][m] + b * twr[t][d][m]; }
  return cr * cr + ci * ci;
}
// refine around (f0 Hz, n0 samples); fills mag[79][8] (dB) and returns refined f / n
static float smag[NSYM][8];
static void fine_sync(float f0, int n0, float *f_out, int *n_out, bool want_mag) {
  if (!tw_ready) tw_init();
  baseband(f0 + 3.5f * 6.25f);
  const int nz = NFFT2, m0 = (int)floorf(n0 / (float)DS + 0.5f);
  float best = -1; int bd = NDF / 2, bm = m0;
  for (int d = 0; d < NDF; ++d) for (int dm = -NDT; dm <= NDT; ++dm) {
    float p = 0;
    for (int c = 0; c < 3; ++c) for (int k = 0; k < 7; ++k) {
      int s = c * 36 + k, mb = m0 + dm + s * NSPSD;
      if (mb < 0 || mb + NSPSD > nz) continue;
      float pt = tone_pow(mb, kFT8_Costas_pattern[k], d), all = 0;
      for (int t = 0; t < 8; ++t) all += t == kFT8_Costas_pattern[k] ? pt : tone_pow(mb, t, d);
      p += pt / (all + 1e-20f); // fraction of the symbol's power in the expected Costas tone
    }
    if (p > best) { best = p; bd = d; bm = m0 + dm; }
  }
  *f_out = f0 + (bd - NDF / 2) * 0.25f; *n_out = bm * DS;
  if (want_mag) for (int s = 0; s < NSYM; ++s) {
    int mb = bm + s * NSPSD;
    for (int t = 0; t < 8; ++t) smag[s][t] = (mb < 0 || mb + NSPSD > nz) ? -120 : 10 * log10f(tone_pow(mb, t, bd) + 1e-12f);
  }
}
static inline double pow10db(float db) { return exp(db * 0.230258509299404568); } // 10^(db/10)
static inline float max4(float a, float b, float c, float d) { float x = a > b ? a : b, y = c > d ? c : d; return x > y ? x : y; }
// demodulate at the refined point and decode (BP, then OSD)
static bool decode_fine(float f0, int n0, ftx_message_t *msg, float *f_out, int *n_out) {
  fine_sync(f0, n0, f_out, n_out, true);
  float llr[FTX_LDPC_N];
  for (int k = 0; k < 58; ++k) {
    const float *w = smag[k + (k < 29 ? 7 : 14)]; float s2[8];
    for (int j = 0; j < 8; ++j) s2[j] = w[kFT8_Gray_map[j]];
    llr[3 * k] = max4(s2[4], s2[5], s2[6], s2[7]) - max4(s2[0], s2[1], s2[2], s2[3]);
    llr[3 * k + 1] = max4(s2[2], s2[3], s2[6], s2[7]) - max4(s2[0], s2[1], s2[4], s2[5]);
    llr[3 * k + 2] = max4(s2[1], s2[3], s2[5], s2[7]) - max4(s2[0], s2[2], s2[4], s2[6]);
  }
  float sum = 0, sum2 = 0;
  for (int i = 0; i < FTX_LDPC_N; ++i) { sum += llr[i]; sum2 += llr[i] * llr[i]; }
  float var = (sum2 - sum * sum / FTX_LDPC_N) / FTX_LDPC_N, nf = sqrtf(24.0f / (var + 1e-12f));
  for (int i = 0; i < FTX_LDPC_N; ++i) llr[i] *= nf;
  float cw[FTX_LDPC_N]; memcpy(cw, llr, sizeof cw);
  uint8_t plain[FTX_LDPC_N]; int errs;
  bp_decode(cw, kLDPC_iterations, plain, &errs);
  if (errs == 0) {
    bits174 c = { { 0, 0, 0 } };
    for (int i = 0; i < FTX_LDPC_N; ++i) if (plain[i]) bset(&c, i);
    uint16_t crc; uint8_t payload[10];
    if (crc_ok(&c, payload, &crc)) { memcpy(msg->payload, payload, 10); msg->hash = crc; return true; }
  }
  return osd_decode(llr, msg);
}

// candidate decode: ft8_lib's own (coarse-grid) decode first; otherwise fine sync + BP + OSD.
// Returns the refined frequency / start sample for subtraction.
static bool decode_cand(const ftx_waterfall_t *wf, const ftx_candidate_t *cand, float f0, int n0, ftx_message_t *msg, float *f, int *n) {
  ftx_decode_status_t st;
  if (ftx_decode_candidate(wf, cand, kLDPC_iterations, msg, &st)) { fine_sync(f0, n0, f, n, true); return true; }
  if (cand->score < kFine_min_score) return false;
  return decode_fine(f0, n0, msg, f, n);
}

// one pass over the (partly subtracted) audio; returns the number of new messages
static int nres;
static int decode_pass(int subtract_after) {
  monitor_reset(&mon);
  spec_valid = false;                            // the audio changed (subtraction): recompute the slot spectrum
  for (int p = 0; p + mon.block_size <= nsig; p += mon.block_size) monitor_process(&mon, sig + p);
  const ftx_waterfall_t *wf = &mon.wf;
  ftx_candidate_t cand_list[kMax_candidates];
  int n_cand = ftx_find_candidates(wf, kMax_candidates, cand_list, kMin_score);
  int first = nseen, found = 0;
  float fr[kMax_decoded]; int tn[kMax_decoded];
  for (int c = 0; c < n_cand && nseen < kMax_decoded; ++c) {
    const ftx_candidate_t *cand = &cand_list[c];
    ftx_message_t msg;
    const float f0 = (mon.min_bin + cand->freq_offset + (float)cand->freq_sub / wf->freq_osr) / mon.symbol_period;
    const float t0 = (cand->time_offset + (float)cand->time_sub / wf->time_osr) * mon.symbol_period;
    float fr_; int tn_;
    if (!decode_cand(wf, cand, f0, (int)((t0 - 0.15f) * FS), &msg, &fr_, &tn_)) continue;
    bool dup = false;
    for (int i = 0; i < nseen; ++i) if (seen[i].hash == msg.hash && !memcmp(seen[i].payload, msg.payload, sizeof msg.payload)) { dup = true; break; }
    if (dup) continue;
    seen[nseen] = msg;
    result_t *r = &results[nres++];
    ftx_message_offsets_t offs;
    if (ftx_message_decode(&msg, &hash_if, r->text, &offs) != FTX_MESSAGE_RC_OK) strcpy(r->text, "?");
    r->freq = (mon.min_bin + cand->freq_offset + (float)cand->freq_sub / wf->freq_osr) / mon.symbol_period;
    r->dt = (cand->time_offset + (float)cand->time_sub / wf->time_osr) * mon.symbol_period;
    r->score = cand->score;
    { // S/N as WSJT-X (ft8b): power in the decoded tones vs the average of the other seven, 2500 Hz reference
      uint8_t tones[NSYM]; ft8_encode(msg.payload, tones);
      double ps = 0, pn = 0;
      for (int k = 0; k < NSYM; ++k) for (int t = 0; t < 8; ++t) { double p = pow10db(smag[k][t]); if (t == tones[k]) ps += p; else pn += p / 7; }
      double x = pn > 0 ? ps / pn - 1 : 1e-3; r->snr = (float)(10 * log10f((float)(x > 1e-3 ? x : 1e-3)) - 27);
      if (r->snr < -24) r->snr = -24;
    }
    fr[nseen] = fr_; tn[nseen] = tn_;
    r->freq = fr_; r->dt = (float)tn_ / FS - 0.5f; // WSJT-X DT: start time relative to the nominal 0.5 s
    nseen++; found++;
  }
  if (subtract_after) for (int i = first; i < nseen; ++i) {
    uint8_t tones[NSYM]; ft8_encode(seen[i].payload, tones);
    subtract(tones, fr[i], tn[i]);
  }
  return found;
}

// decode the stored slot; returns the number of messages written to results[]
EXPORT int ft8_decode(void) {
  nres = nseen = 0;
  for (int pass = 0; pass < kPasses; ++pass) if (!decode_pass(pass < kPasses - 1) && pass > 0) break;
  ht_cleanup(10);
  return nres;
}

// ---- transmit: pack a message text into the 79 FT8 tones (the GFSK waveform is synthesised in JS) ----
static char tx_text[kTextLen];
static uint8_t tx_tones[NSYM];
EXPORT char *ft8_tx_text_ptr(void) { return tx_text; }
EXPORT uint8_t *ft8_tx_tones_ptr(void) { return tx_tones; }
// in: tx_text (NUL-terminated, upper case). out: tx_tones, and tx_text rewritten as the message unpacks
// (what the other station will see). Returns the ftx_message_rc_t (0 = OK).
EXPORT int ft8_tx_encode(void) {
  ftx_message_t msg;
  tx_text[kTextLen - 1] = 0;
  int rc = ftx_message_encode(&msg, &hash_if, tx_text);
  if (rc != FTX_MESSAGE_RC_OK) return rc ? rc : -1;
  ft8_encode(msg.payload, tx_tones);
  char text[FTX_MAX_MESSAGE_LENGTH]; ftx_message_offsets_t ofs;
  if (ftx_message_decode(&msg, &hash_if, text, &ofs) == FTX_MESSAGE_RC_OK) { strncpy(tx_text, text, kTextLen - 1); tx_text[kTextLen - 1] = 0; }
  return 0;
}
