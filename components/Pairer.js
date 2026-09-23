"use client";

import { useEffect, useRef, useState } from "react";

const MAX_EDGE = 1024;
const WEARERS = [
  { label: "Auto-detect", value: "" },
  { label: "Men", value: "men" },
  { label: "Women", value: "women" },
  { label: "Unisex", value: "unisex" },
];
const OCCASIONS = [
  { label: "Everyday", value: "" },
  { label: "Casual weekend", value: "Casual weekend" },
  { label: "Work / office", value: "Work / office" },
  { label: "Date night", value: "Date night" },
  { label: "Night out", value: "Party / night out" },
  { label: "Wedding / formal", value: "Wedding / formal event" },
  { label: "Travel", value: "Travel" },
  { label: "Gym / athleisure", value: "Gym / athleisure" },
];
const CHIPS = [
  "I mostly wear dark colors",
  "Budget-friendly",
  "Minimal / clean look",
  "Streetwear vibe",
  "No heels",
  "Keep it comfortable",
];
const STEPS = ["Reading the piece", "Matching color & style", "Building your look"];

const titleCase = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
const validColor = (c) => typeof CSS !== "undefined" && CSS.supports("color", c);

function loadAndResize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      URL.revokeObjectURL(url);
      resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg", name: file.name || "photo" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

function Swatch({ color }) {
  if (!validColor(color)) return <span className="swatch">{color}</span>;
  const light = /^(white|#fff|#ffffff)$/i.test(String(color).trim());
  return (
    <span className="swatch">
      <i style={{ background: color, boxShadow: light ? "inset 0 0 0 1px var(--color-neutral-500)" : undefined }} />
      {color}
    </span>
  );
}

function LookTile({ href, image, alt, badge, kicker, kickerClass, title, fade, fallback }) {
  const body = (
    <>
      <div className="tile-media">
        {image ? (
          <img src={image} alt={alt || ""} referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />
        ) : fallback ? (
          <span className="tile-fallback">{fallback}</span>
        ) : null}
        {badge ? <span className="yours-badge">{badge}</span> : null}
      </div>
      <div className="tile-cap">
        <span className={`tile-kicker ${kickerClass}`}>{kicker}</span>
        <span className="tile-name">{title}</span>
      </div>
    </>
  );
  if (href) {
    return (
      <a className="look-tile" href={href} style={{ opacity: fade }}>
        {body}
      </a>
    );
  }
  return <figure className="look-yours">{body}</figure>;
}

export default function Pairer() {
  const fileRef = useRef(null);
  const loadingRef = useRef(null);
  const errorRef = useRef(null);
  const resultRef = useRef(null);
  const scrollResult = useRef(false);
  const busyRef = useRef(false);
  const swapLock = useRef(false);
  const [image, setImage] = useState(null);
  const [drag, setDrag] = useState(false);
  const [audience, setAudience] = useState("");
  const [occasion, setOccasion] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [swapping, setSwapping] = useState(null);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(""), 1600);
  }

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    loadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const id = setInterval(() => setStep((s) => (s < 2 ? s + 1 : s)), 2200);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [error]);

  useEffect(() => {
    if (scrollResult.current && result) {
      scrollResult.current = false;
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Please pick an image file.");
      return;
    }
    try {
      const next = await loadAndResize(file);
      setImage(next);
      setResult(null);
      setError(null);
      setSwapping(null);
    } catch (err) {
      showToast(err.message);
    }
  }

  function clearPhoto() {
    setImage(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addChip(text) {
    if (notes.includes(text)) return;
    setNotes((prev) => (prev.trim() ? prev.trim().replace(/\.?$/, ". ") : "") + text + ".");
  }

  function requestBody(extra = {}) {
    return {
      image: image.base64,
      mediaType: image.mediaType,
      audience,
      occasion,
      notes: notes.trim(),
      ...extra,
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!image || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "refused") {
          setError({ title: "The model declined this photo.", detail: data.message || "Try a different photo of one clothing item." });
        } else {
          setError({ title: "Something went wrong.", detail: data.message || "Try again in a moment." });
        }
        return;
      }
      if (!data.is_clothing) {
        const reason = data.message || "";
        const generic = "That doesn't look like a clothing item.";
        setError({
          title: generic,
          detail: reason && reason !== generic
            ? reason
            : "Try a single top, bottom, shoe or accessory — flat on a surface or worn, in good light.",
        });
        return;
      }
      scrollResult.current = true;
      setResult({
        item: data.item,
        suggestions: data.suggestions,
        rejected: {},
        usage: { ...data.usage },
      });
    } catch {
      setError({ title: "Something went wrong.", detail: "Network error. Is the server running?" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onSwap(i) {
    if (!result || swapLock.current || !image) return;
    swapLock.current = true;
    const old = result.suggestions[i];
    const cat = old.category;
    const rejectedList = [...(result.rejected[cat] || []), old.item];
    setResult((r) => ({ ...r, rejected: { ...r.rejected, [cat]: rejectedList } }));
    setSwapping(i);
    try {
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody({
          item: result.item,
          category: cat,
          rejected: rejectedList,
          current: result.suggestions.filter((_, j) => j !== i).map((s) => s.item),
        })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.message || "Couldn't swap that one.");
        return;
      }
      setResult((r) => {
        const suggestions = r.suggestions.slice();
        suggestions[i] = data.suggestion;
        return {
          ...r,
          suggestions,
          usage: {
            input_tokens: r.usage.input_tokens + (data.usage?.input_tokens || 0),
            output_tokens: r.usage.output_tokens + (data.usage?.output_tokens || 0),
          },
        };
      });
    } catch {
      showToast("Network error while swapping.");
    } finally {
      swapLock.current = false;
      setSwapping(null);
    }
  }

  async function copyQuery(i, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      showToast("Copied: " + text);
    } catch {
      showToast(text);
    }
    setTimeout(() => setCopied((current) => (current === i ? null : current)), 1400);
  }

  const findLabel = busy
    ? "Finding matches…"
    : !image
      ? "Add a photo to start"
      : result
        ? "Find new matches"
        : "Find matches";

  const whoLabel = audience
    ? WEARERS.find((w) => w.value === audience)?.label
    : `${titleCase(result?.item.audience || "unisex")} (detected)`;
  const occLabel = OCCASIONS.find((o) => o.value === occasion)?.label || "Everyday";

  return (
    <div className="page">
      <header className="site-header">
        <span className="brand"><span className="brand-sq" />Pairer</span>
        <span className="tagline">One piece in. Three out.</span>
      </header>

      <main className="wrap">
        <form onSubmit={onSubmit}>
          <section className="hero">
            <div className="hero-copy">
              <div>
                <span className="kicker">01 — Show us the piece</span>
                <h1 className="hero-title">What goes<br />with this?</h1>
              </div>
              <p className="lede">Snap one clothing item. We&apos;ll build the look around it — three pieces, each ready to buy.</p>
            </div>

            <div
              className={`photo${drag ? " drag" : ""}`}
              onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (e.currentTarget.contains(e.relatedTarget)) return;
                setDrag(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                handleFile(e.dataTransfer.files[0]);
              }}
            >
              <input
                id="photo"
                ref={fileRef}
                type="file"
                className="file-input"
                accept="image/*"
                capture="environment"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {!image ? (
                <label htmlFor="photo" className="photo-empty">
                  <span className="photo-plus">+</span>
                  <span className="photo-title">Take or upload a photo</span>
                  <span className="photo-hint">One item, flat or worn. Opens the camera on your phone.</span>
                </label>
              ) : (
                <div className="photo-filled">
                  <div className="photo-frame">
                    <img src={image.dataUrl} alt="Selected item" />
                  </div>
                  <div className="photo-bar">
                    <span className="photo-name">{image.name}</span>
                    <label htmlFor="photo" className="photo-change">Change photo</label>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="inputs">
            <div className="cell cell-who">
              <span className="kicker">02 — Who&apos;s wearing it</span>
              <div className="choice-grid" role="group" aria-label="Who's wearing it">
                {WEARERS.map((w) => (
                  <button key={w.label} type="button" className="choice" aria-pressed={audience === w.value} onClick={() => setAudience(w.value)}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cell cell-occ">
              <span className="kicker">03 — Occasion</span>
              <div className="choice-grid" role="group" aria-label="Occasion">
                {OCCASIONS.map((o) => (
                  <button key={o.label} type="button" className="choice" aria-pressed={occasion === o.value} onClick={() => setOccasion(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cell cell-notes">
              <span className="kicker">04 — Style notes</span>
              <textarea className="notes" rows={3} placeholder="Colors you avoid, budget, fit…" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <div className="chips">
                {CHIPS.map((chip) => {
                  const on = notes.includes(chip);
                  return (
                    <button key={chip} type="button" className="chip" aria-pressed={on} onClick={() => addChip(chip)}>
                      {on ? "✓ " : "+ "}{chip}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="find-bar">
            <button className="find" type="submit" disabled={!image || busy}>
              <span>{findLabel}</span><span aria-hidden="true">→</span>
            </button>
          </div>
        </form>

        {busy && (
          <section ref={loadingRef} className="loading">
            <span className="kicker">Working on it</span>
            <div className="load-list">
              {STEPS.map((label, i) => (
                <div key={label} className="load-step" style={{ color: i <= step ? "var(--color-text)" : "var(--color-neutral-400)" }}>
                  <span className="num">0{i + 1}</span>
                  <span className="label">{label}</span>
                  <span className="mark">{i < step ? "Done" : i === step ? "…" : ""}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {error && (
          <section ref={errorRef} className="error-block">
            <span className="kicker">Couldn&apos;t pair that</span>
            <h2>{error.title}</h2>
            <p>{error.detail}</p>
            <button type="button" className="text-btn" onClick={clearPhoto}>Try another photo</button>
          </section>
        )}

        {result && (
          <div ref={resultRef}>
            <section className="shown">
              <div>
                <span className="kicker">You showed us</span>
                <h2>{result.item.name}</h2>
              </div>
              <div className="shown-meta">
                {result.item.colors?.length ? (
                  <div className="swatches">{result.item.colors.map((c) => <Swatch key={c} color={c} />)}</div>
                ) : null}
                <div className="tags">
                  {[result.item.pattern, result.item.style, result.item.formality, result.item.audience].filter(Boolean).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
            </section>

            <section className="look">
              <div className="section-head">
                <span className="kicker">The look</span>
                <span className="section-note">{occLabel} · {whoLabel}</span>
              </div>
              <div className="look-grid">
                <LookTile
                  image={image?.dataUrl}
                  alt="Your item"
                  badge="Yours"
                  kicker={titleCase(result.item.category)}
                  kickerClass="yours"
                  title={result.item.name}
                />
                {result.suggestions.map((s, i) => (
                  <LookTile
                    key={`${s.category}-${i}`}
                    href={`#piece-${i + 1}`}
                    image={s.products?.[0]?.image || ""}
                    alt={s.item}
                    kicker={`${String(i + 1).padStart(2, "0")} · ${titleCase(s.category)}`}
                    kickerClass="pair"
                    title={s.item}
                    fade={swapping === i ? 0.4 : 1}
                    fallback={titleCase(s.category)}
                  />
                ))}
              </div>
            </section>

            <section className="shop">
              <div className="section-head">
                <span className="kicker">Shop the pieces</span>
                <span className="section-note">Not feeling one? Swap it — the rest of the look stays.</span>
              </div>
              <div className="shop-grid">
                {result.suggestions.map((s, i) => {
                  const fading = swapping === i;
                  return (
                    <article key={`${s.item}-${i}`} id={`piece-${i + 1}`} className="piece" style={{ opacity: fading ? 0.4 : 1 }}>
                      <div className="piece-top">
                        <span className="piece-id">
                          <span className="piece-num">{String(i + 1).padStart(2, "0")}</span>
                          <span className="piece-cat">{titleCase(s.category)}</span>
                        </span>
                        <button type="button" className="swap-btn" disabled={fading} onClick={() => onSwap(i)}>
                          {fading ? "Finding…" : "Not this one ↻"}
                        </button>
                      </div>
                      <h3>{s.item}</h3>
                      <p className="why">{s.why}</p>
                      {s.products?.length ? (
                        <div className="products">
                          {s.products.map((p) => (
                            <a key={p.link} className="product" href={p.link} target="_blank" rel="noopener noreferrer">
                              <span className="product-shot">
                                <img src={p.image} alt={p.title || ""} loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />
                              </span>
                              <span className="product-meta">{[p.price, p.source].filter(Boolean).join(" · ") || p.title}</span>
                            </a>
                          ))}
                        </div>
                      ) : null}
                      <div className="shop-links">
                        <a className="shop-google" href={s.links?.google || "#"} target="_blank" rel="noopener noreferrer"><span>Google Shopping</span><span>↗</span></a>
                        <a className="shop-amazon" href={s.links?.amazon || "#"} target="_blank" rel="noopener noreferrer"><span>Amazon</span><span>↗</span></a>
                      </div>
                      <button type="button" className="copy-btn" onClick={() => copyQuery(i, s.search_query || "")}>
                        {copied === i ? "Copied ✓" : "Copy search text"}
                      </button>
                    </article>
                  );
                })}
              </div>
              <div className="results-foot">
                <span className="section-note">tokens in {result.usage.input_tokens} · out {result.usage.output_tokens}</span>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    clearPhoto();
                    setResult(null);
                    setSwapping(null);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Try another item
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status">{toast}</div>
    </div>
  );
}
