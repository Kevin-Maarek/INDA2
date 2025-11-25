flowchart TD

%% =======================
%% Users & Frontend
%% =======================
User([משתמש])
Frontend[Next.js Frontend\n- Input + Send\n- Dev Mode\n- Feedback Viewer\n- SSE Logs Stream]

User --> Frontend

%% =======================
%% Query Service
%% =======================
Frontend -->|HTTP GET /ask_stream?question=...| QueryService
Frontend -->|HTTP POST /ask| QueryService

subgraph QueryService[FASTAPI QUERY SERVICE\n(ask, ask_stream)]
    direction TB

    QS_Ask[POST /ask\n• מריץ run_agent\n• מחזיר JSON סופי בלבד]
    QS_Stream[GET /ask_stream\n• מפעיל event_generator\n• שולח לוגים + תשובה סופית ב-SSE]

    QS_Ask --> QS_Sandbox
    QS_Stream --> QS_Sandbox

    subgraph QS_Sandbox[sandbox_create_env()]
        direction TB
        PySandbox[Python Sandbox\n- utils\n- numpy\n- pandas\n- matplotlib Agg\n- io/base64\n- dynamic stdout capture\n- sys.modules["utils"]]
    end

    QS_Sandbox --> RunAgent
end

%% =======================
%% RunAgent Logic
%% =======================
subgraph RunAgent[run_agent(user_question)]
    direction TB

    RA_Attempt1[Attempt 1:\ngenerate Python code with LLM]
    RA_Execute1[exec(code)...\n• אם שגיאה → Attempt 2\n• אם הצלחה → מחזיר תשובה]
    RA_Fallback["אם יש שגיאה:\nBuild new prompt:\n'Previous attempt failed...'\n→ regenerate code"]
    RA_Return[final_answer + history]

    RunAgent --> RA_Attempt1 --> RA_Execute1
    RA_Execute1 -->|error| RA_Fallback --> RA_Attempt1
    RA_Execute1 -->|success| RA_Return
end

%% =======================
%% Agent LLM Logic
%% =======================
subgraph AgentLLM[NVIDIA LLM\nLLAMA-4 MAVERICK 17B\n(meta/llama-4-maverick-17b-128e-instruct)]
    direction TB

    A_Prompt[AGENT_PROMPT\n• strict Python code\n• no markdown\n• Hebrew logs with §\n• semantic rules\n• allowed imports only\n• must define final_answer]
    A_Code[Generates Raw Python Code\n(no comments)]

    A_Prompt --> A_Code
end

RA_Attempt1 -->|system_prompt + user_prompt| AgentLLM
AgentLLM -->|Generated Python code| QS_Sandbox

%% =======================
%% Generated Code Logic
%% =======================
subgraph GeneratedCode["Generated Python Pipeline\n(via LLM)"]
    direction TB

    GC_GetAll[utils.get_all_feedback()]
    GC_Filtering[סינון מבני\noffice/service/Level]
    GC_Semantic["Semantic Search:\nutils.embed → utils.search_feedback → utils.dynamic_cutoff"]
    GC_LLMAsk["utils.ask_llm(system_prompt, user_prompt)"]
    GC_Charts[matplotlib → base64 image]
    GC_Table[pd.DataFrame → ליסט של dict]
    GC_FinalAnswer[final_answer {...}]

    GC_GetAll --> GC_Filtering
    GC_Filtering --> GC_Semantic
    GC_Semantic --> GC_LLMAsk
    GC_LLMAsk --> GC_Charts
    GC_LLMAsk --> GC_Table
    GC_Charts --> GC_FinalAnswer
    GC_Table --> GC_FinalAnswer
end

QS_Sandbox --> GeneratedCode
GeneratedCode -->|print logs| QS_Stream
GeneratedCode -->|final_answer| QS_Stream

%% =======================
%% Utils + Qdrant + NVIDIA
%% =======================
subgraph UtilsPy[utils.py]
    direction TB

    U_Embed[embed(text)\n→ NVIDIA embeddings API\n(model: nvidia/llama-3.2-nemoretriever-300m-embed-v2)]
    U_AskLLM[ask_llm(...)\n→ NVIDIA Chat Completion API]
    U_Search[search_feedback(vector)\n→ Qdrant search]
    U_Dynamic[dynamic_cutoff(query, results)\n• engineering drop cutoff\n• LLM-based relevance filter]
    U_GetAll[get_all_feedback()]
end

%% Qdrant block
subgraph Qdrant[QDRANT VECTOR DB\ncollection: feedback_vectors]
    direction TB
    Q_Vectors[Vectors 300D]\n
    Q_Payloads[payload:\nID, Text, Level, service, office]
end

%% NVIDIA API block
subgraph NVIDIAAPI[NVIDIA API]
    direction TB
    nvidia_embed[Embeddings Endpoint\n(nvidia/llama-3.2-*)]
    nvidia_chat[Chat Completion Endpoint\n(meta/llama-4-maverick-17b-128e)]
end

%% Connections
GeneratedCode -->|embedding| U_Embed --> nvidia_embed
GeneratedCode -->|ask_llm| U_AskLLM --> nvidia_chat
GeneratedCode -->|semantic search| U_Search --> Qdrant
U_Dynamic --> GeneratedCode

GC_GetAll --> U_GetAll --> Qdrant

%% =======================
%% File Ingestion Service
%% =======================
User -->|Upload CSV| Ingestion
Frontend -->|POST /upload_csv| Ingestion

subgraph Ingestion[FASTAPI FILE INGESTION SERVICE]
    direction TB

    ING_File[Upload CSV\n/ ServiceName split]
    ING_Build[Build embedding_text:\n• Level\n• service\n• office\n• Text]
    ING_Batch[Batch embedding\n(BATCH_SIZE_EMBEDDING=16)]
    ING_Nvidia[get_embeddings_batch(texts)\n→ NVIDIA embeddings API]
    ING_Ensure[ensure_collection(dim)\ncreate if missing]
    ING_Qdrant[qdrant.upsert()]
end

ING_File --> ING_Build --> ING_Batch --> ING_Nvidia --> ING_Ensure --> ING_Qdrant
ING_Qdrant --> Qdrant
