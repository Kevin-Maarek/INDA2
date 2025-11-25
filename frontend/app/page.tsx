"use client";

import { useState, useMemo } from "react";

export default function HomePage() {
  const [question, setQuestion] = useState("");
  const [responseObj, setResponseObj] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  // לוגים בזמן אמת — רשימת משפטים
  const [logs, setLogs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Dev Mode
  const [devMode, setDevMode] = useState(false);
  const [devHistory, setDevHistory] = useState<any[]>([]);

  // 🔹 צפייה בפידבקים (Modal)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const [filterOffice, setFilterOffice] = useState("");
  const [filterService, setFilterService] = useState("");
  const [filterLevel, setFilterLevel] = useState("");

  // ----------------------------------------
  // שליחת שאלה — Streaming EventSource
  // ----------------------------------------
  const sendQuery = () => {
    if (!question.trim()) return;

    setLoading(true);
    setResponseObj(null);
    setLogs([]);
    setDevHistory([]);

    const url = `http://localhost:8004/ask_stream?question=${encodeURIComponent(
      question
    )}`;

    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "log") {
          const msg = data.message.trim();

          // רק לוגים עם § מוצגים
          if (msg.startsWith("§")) {
            const clean = msg.replace(/^§\s?/, "");
            setLogs((prev) => [...prev, clean]);
          }
        } else if (data.type === "result") {
          const raw = data.answer;
          let normalized: any;

          if (raw?.type) normalized = raw;
          else if (raw?.answer) normalized = raw.answer;
          else if (raw?.response) normalized = raw.response;
          else {
            normalized = {
              type: "text",
              text: JSON.stringify(raw),
              image: null,
              table: null,
            };
          }

          setResponseObj(normalized);
          setDevHistory(data.history || []); // היסטוריית ניסיונות ל-Dev Mode

          setLoading(false);
          es.close();
        } else if (data.type === "error") {
          setResponseObj({
            type: "text",
            text: `❌ שגיאה בשרת: ${data.error}`,
          });
          setLoading(false);
          es.close();
        }
      } catch (e) {
        console.error("Bad SSE message", e);
      }
    };

    es.onerror = () => {
      setResponseObj({
        type: "text",
        text: "❌ שגיאה בחיבור ל־stream",
      });
      setLoading(false);
      es.close();
    };
  };

  // ----------------------------------------
  // העלאת CSV
  // ----------------------------------------
  const autoUploadCSV = async (file: File | null) => {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setResponseObj(null);

    try {
      const res = await fetch("http://localhost:8010/upload_csv", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setResponseObj({ type: "text", text: data?.message });
    } catch {
      setResponseObj({
        type: "text",
        text: "❌ שגיאה בהעלאת הקובץ",
      });
    }

    setLoading(false);
  };

  // ----------------------------------------
  // DEV MODE
  // ----------------------------------------
  const renderDevMode = () => {
    if (!devMode) return null;

    if (!devHistory || devHistory.length === 0) {
      return (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: 8,
            background: "#F7F7F8",
            border: "1px solid #E2E3E5",
            fontSize: 14,
            color: "#555",
            direction: "rtl",
          }}
        >
          אין עדיין מידע ל-Dev Mode (לא התקבלה היסטוריית קוד מהשרת).
        </div>
      );
    }

    return (
      <div
        style={{
          marginTop: 30,
          padding: 20,
          background: "#1A1A1A",
          borderRadius: 10,
          color: "#EAEAEA",
          direction: "ltr",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
        }}
      >
        <h3 style={{ color: "#4FC3F7", marginTop: 0 }}>
          Developer Mode — Attempt History
        </h3>

        {devHistory.map((item: any, idx: number) => (
          <div
            key={idx}
            style={{
              padding: 16,
              marginTop: 14,
              background: "#2A2A2A",
              borderRadius: 8,
              border: "1px solid #444",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 8,
                fontSize: 14,
              }}
            >
              Attempt {item.attempt}
            </div>

            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  color: "#81C784",
                  fontSize: 13,
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                Code:
              </div>
              <pre
                style={{
                  background: "#111",
                  padding: 10,
                  borderRadius: 6,
                  whiteSpace: "pre-wrap",
                  overflowX: "auto",
                  fontSize: 12,
                  direction: "ltr",
                }}
              >
{item.code}
              </pre>
            </div>

            {item.error && (
              <div>
                <div
                  style={{
                    color: "#E57373",
                    fontSize: 13,
                    marginBottom: 4,
                    fontWeight: 600,
                  }}
                >
                  Error:
                </div>
                <pre
                  style={{
                    background: "#300",
                    padding: 10,
                    borderRadius: 6,
                    whiteSpace: "pre-wrap",
                    overflowX: "auto",
                    fontSize: 12,
                    direction: "ltr",
                  }}
                >
{item.error}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // ----------------------------------------
  // FEEDBACK MODAL – לטעון מה-API
  // ----------------------------------------
  const fetchFeedbacks = async () => {
    try {
      setFeedbackLoading(true);
      setFeedbackError(null);

      const params = new URLSearchParams();
      if (filterOffice) params.append("office", filterOffice);
      if (filterService) params.append("service", filterService);
      if (filterLevel) params.append("level", filterLevel);

      const url = `http://localhost:8004/feedbacks?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setFeedbacks(data.feedbacks || []);
    } catch (e: any) {
      setFeedbackError("שגיאה בטעינת הפידבקים");
      console.error(e);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const openFeedbackModal = async () => {
    setShowFeedbackModal(true);
    // בפתיחה ראשונית נטען בלי פילטרים
    setFilterOffice("");
    setFilterService("");
    setFilterLevel("");
    await fetchFeedbacks();
  };

  const closeFeedbackModal = () => {
    setShowFeedbackModal(false);
  };

  // רשימות ייחודיות לפילטרים (מכאן ולא מהשרת)
  const officeOptions = useMemo(
    () => Array.from(new Set(feedbacks.map((f) => f.office).filter(Boolean))),
    [feedbacks]
  );
  const serviceOptions = useMemo(
    () => Array.from(new Set(feedbacks.map((f) => f.service).filter(Boolean))),
    [feedbacks]
  );
  const levelOptions = useMemo(
    () =>
      Array.from(
        new Set(
          feedbacks
            .map((f) => f.Level)
            .filter((v) => v !== null && v !== undefined)
        )
      ).sort(),
    [feedbacks]
  );

  const renderFeedbackModal = () => {
    if (!showFeedbackModal) return null;

    const columns =
      feedbacks.length > 0 ? Object.keys(feedbacks[0]) : ["ID", "Text"];

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={closeFeedbackModal}
      >
        <div
          style={{
            width: "90%",
            maxWidth: "1100px",
            maxHeight: "85vh",
            background: "#ffffff",
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            direction: "rtl",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* כותרת + סגירה */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20 }}>צפייה בפידבקים</h2>
            <button
              onClick={closeFeedbackModal}
              style={{
                border: "none",
                background: "transparent",
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          {/* פילטרים */}
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <label style={{ fontSize: 13 }}>משרד</label>
              <select
                value={filterOffice}
                onChange={(e) => setFilterOffice(e.target.value)}
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #C5D0DA",
                  minWidth: 140,
                }}
              >
                <option value="">כל המשרדים</option>
                {officeOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 13 }}>שירות</label>
              <select
                value={filterService}
                onChange={(e) => setFilterService(e.target.value)}
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #C5D0DA",
                  minWidth: 160,
                }}
              >
                <option value="">כל השירותים</option>
                {serviceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 13 }}>ציון</label>
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #C5D0DA",
                  minWidth: 80,
                }}
              >
                <option value="">כל הציונים</option>
                {levelOptions.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={fetchFeedbacks}
              style={{
                marginTop: 18,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#005EB8",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              החל פילטרים
            </button>
          </div>

          {/* תוכן הטבלה */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              border: "1px solid #E2E3E5",
              borderRadius: 8,
            }}
          >
            {feedbackLoading ? (
              <div style={{ padding: 20, textAlign: "center" }}>
                טוען פידבקים...
              </div>
            ) : feedbackError ? (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "#C62828",
                }}
              >
                {feedbackError}
              </div>
            ) : feedbacks.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center" }}>
                לא נמצאו פידבקים.
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "#F0F4F8" }}>
                    {columns.map((key) => (
                      <th
                        key={key}
                        style={{
                          padding: "8px 6px",
                          borderBottom: "1px solid #C5D0DA",
                          textAlign: "right",
                          position: "sticky",
                          top: 0,
                          background: "#F0F4F8",
                          zIndex: 1,
                        }}
                      >
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {feedbacks.map((row, i) => (
                    <tr key={i}>
                      {columns.map((key) => (
                        <td
                          key={key}
                          style={{
                            padding: "6px 6px",
                            borderBottom: "1px solid #E6ECF1",
                            verticalAlign: "top",
                          }}
                        >
                          {String(row[key] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "40px 20px",
        direction: "rtl",
        fontFamily: "Assistant, Arial, sans-serif",
      }}
    >
      {/* לוגו */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <img
          src="/logo.png"
          alt="Logo"
          style={{
            width: 380,
            height: "auto",
            opacity: 0.95,
            filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.15))",
          }}
        />
      </div>

      {/* אזור קלט ושילוח */}
<div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 25,
    width: "100%",
  }}
>
  {/* שורה 1 — INPUT + שלח */}
  <div
    style={{
      display: "flex",
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      width: "100%",
    }}
  >
    <input
      type="text"
      placeholder="מה תרצה לדעת על המשובים?"
      value={question}
      onChange={(e) => setQuestion(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && sendQuery()}
      style={{
        flex: 1,
        padding: "14px 16px",
        borderRadius: 8,
        border: "1px solid #C5D0DA",
        fontSize: 17,
        background: "#ffffff",
        boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
      }}
    />

    <button
      onClick={sendQuery}
      style={{
        padding: "12px 22px",
        borderRadius: 8,
        backgroundColor: "#005EB8",
        color: "white",
        border: "none",
        fontSize: 16,
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
        whiteSpace: "nowrap",
      }}
    >
      שלח
    </button>
  </div>

  {/* שורה 2 — כפתורים נוספים */}
  <div
    style={{
      display: "flex",
      flexDirection: "row",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "center",
    }}
  >
    <button
      onClick={() => setDevMode((prev) => !prev)}
      style={{
        padding: "12px 18px",
        borderRadius: 8,
        backgroundColor: devMode ? "#C62828" : "#6C757D",
        color: "white",
        border: "none",
        fontSize: 14,
        cursor: "pointer",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {devMode ? "סגור Dev Mode" : "פתח Dev Mode"}
    </button>

    <button
      onClick={openFeedbackModal}
      style={{
        padding: "12px 18px",
        borderRadius: 8,
        backgroundColor: "#11A674",
        color: "white",
        border: "none",
        fontSize: 14,
        cursor: "pointer",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      צפייה בפידבקים
    </button>

    <label
      style={{
        padding: "12px 18px",
        borderRadius: 8,
        backgroundColor: "#F3F6F9",
        border: "1px solid #C5D0DA",
        cursor: "pointer",
        fontSize: 15,
        color: "#003B70",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      העלה CSV
      <input
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => autoUploadCSV(e.target.files?.[0] || null)}
      />
    </label>
  </div>
</div>


      {/* טוען */}
      {loading && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <div className="loader"></div>
          <p style={{ marginTop: 10, color: "#003B70" }}>מעבד בקשה...</p>

          <style>
            {`
            .loader {
              border: 5px solid #e3eaf1;
              border-top: 5px solid #005EB8;
              border-radius: 50%;
              width: 50px;
              height: 50px;
              animation: spin 0.9s linear infinite;
              margin: 0 auto;
            }

            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
          </style>
        </div>
      )}

      {/* לוגים בזמן אמת — בלוק אחד שנפתח/נסגר */}
      {logs.length > 0 && (
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 20,
            background: "#F7F7F8",
            borderRadius: 8,
            padding: "16px 18px",
            border: "1px solid #E2E3E5",
            fontSize: 15,
            lineHeight: 1.8,
            direction: "rtl",
            whiteSpace: "pre-line",
            cursor: "pointer",
            animation: "fadeIn 0.35s ease, slideUp 0.35s ease",
            transition: "0.25s",
          }}
        >
          {!expanded ? (
            // מצב סגור — רק המשפט העדכני
            <>{`${logs.length}. ${logs[logs.length - 1]}`}</>
          ) : (
            // מצב פתוח — מציג את כל ההיסטוריה
            <>
              {logs.map((line, idx) => `${idx + 1}. ${line}`).join("\n")}
            </>
          )}
        </div>
      )}

      {/* Dev Mode Panel */}
      {renderDevMode()}

      {/* פלט */}
      {!loading && responseObj && (
        <div
          style={{
            marginTop: 30,
            padding: 25,
            background: "#ffffff",
            borderRadius: 10,
            border: "1px solid #D2DCE5",
            boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
            lineHeight: 1.7,
            fontSize: 17,
          }}
        >
          {/* טקסט */}
          {responseObj.text && (
            <div
              style={{
                direction: "rtl",
                whiteSpace: "pre-line",
                fontSize: "1.1rem",
                lineHeight: "1.8",
                padding: "16px",
              }}
            >
              {responseObj.text}
            </div>
          )}

          {/* תמונה */}
          {responseObj.image && (
            <img
              src={
                responseObj.image.startsWith("data:image")
                  ? responseObj.image
                  : `data:image/png;base64,${responseObj.image}`
              }
              style={{
                width: "100%",
                borderRadius: 8,
                margin: "20px 0",
              }}
            />
          )}

          {/* טבלה */}
          {Array.isArray(responseObj.table) && responseObj.table.length > 0 && (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginTop: 20,
              }}
            >
              <thead>
                <tr style={{ background: "#F0F4F8" }}>
                  {Object.keys(responseObj.table[0]).map((key) => (
                    <th
                      key={key}
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #C5D0DA",
                        textAlign: "right",
                        color: "#003B70",
                      }}
                    >
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responseObj.table.map((row: any, i: number) => (
                  <tr key={i}>
                    {Object.values(row).map((val: any, j: number) => (
                      <td
                        key={j}
                        style={{
                          padding: "10px 8px",
                          borderBottom: "1px solid #E6ECF1",
                        }}
                      >
                        {String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* FEEDBACK POPUP */}
      {renderFeedbackModal()}

      {/* אנימציות */}
      <style>
        {`
  @keyframes slideUp {
    from { transform: translateY(14px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`}
      </style>
    </div>
  );
}
