const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const oracledb = require('oracledb');
const path = require('path');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Oracle config ──────────────────────────────────────────────────────────────
try { oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_23_4' }); } catch(e) {}
const oracleConfig = {
    user: 'apps_readonly',
    password: 'GsdjdRuta975',
    connectString: '115.124.111.4:1521/BMLPROD'
};
async function oraclePool() {
    return await oracledb.getConnection(oracleConfig);
}

// ── SQL Server config ──────────────────────────────────────────────────────────
const sqlConfig = {
    user: 'sa',
    password: 'Bamul@1234',
    server: 'localhost',
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 30000, requestTimeout: 30000 }
};

let sqlPool = null;
sql.connect(sqlConfig).then(pool => {
    sqlPool = pool;
    console.log('Connected to SQL Server');
}).catch(err => {
    console.error('SQL Server connection failed:', err.message);
});

// ── Date condition helper ──────────────────────────────────────────────────────
// dateOnly=true  → plain date compare (MilkRecipt, MilkDispatch — date-only fields)
// dateOnly=false → 04:45 dairy shift (BAMUL_MIS LogTime — full datetime fields)
function dateCond(field, filter, start, end, startTime, endTime, dateOnly = false) {
    const NOW = 'DATEADD(MINUTE,330,GETDATE())';
    if (dateOnly) {
        if (filter === 'today')     return `CAST(${field} AS DATE) = CAST(${NOW} AS DATE)`;
        if (filter === 'yesterday') return `CAST(${field} AS DATE) = CAST(DATEADD(DAY,-1,${NOW}) AS DATE)`;
        if (filter === 'week')      return `CAST(${field} AS DATE) >= CAST(DATEADD(DAY,1-DATEPART(WEEKDAY,${NOW}),${NOW}) AS DATE) AND CAST(${field} AS DATE) <= CAST(${NOW} AS DATE)`;
        if (filter === 'month')     return `CAST(${field} AS DATE) >= DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AND CAST(${field} AS DATE) <= CAST(DATEADD(DAY,-1,${NOW}) AS DATE)`;
        if (filter === 'custom' && start && end) return `CAST(${field} AS DATE) >= '${start}' AND CAST(${field} AS DATE) <= '${end}'`;
        return `CAST(${field} AS DATE) >= DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AND CAST(${field} AS DATE) <= CAST(${NOW} AS DATE)`;
    }
    // Full datetime: 04:45 dairy shift
    if (filter === 'today')     return `${field} >= DATEADD(MINUTE,285,CAST(CAST(${NOW} AS DATE) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(DATEADD(DAY,1,${NOW}) AS DATE) AS DATETIME))`;
    if (filter === 'yesterday') return `${field} >= DATEADD(MINUTE,285,CAST(CAST(DATEADD(DAY,-1,${NOW}) AS DATE) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(${NOW} AS DATE) AS DATETIME))`;
    if (filter === 'week')      return `${field} >= DATEADD(MINUTE,285,CAST(CAST(DATEADD(DAY,1-DATEPART(WEEKDAY,${NOW}),${NOW}) AS DATE) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(DATEADD(DAY,1,${NOW}) AS DATE) AS DATETIME))`;
    if (filter === 'month')     return `${field} >= DATEADD(MINUTE,285,CAST(DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(DATEADD(DAY,1,${NOW}) AS DATE) AS DATETIME))`;
    if (filter === 'custom' && start && end) {
        const from = startTime ? `'${start}T${startTime.length === 5 ? startTime + ':00' : startTime}'` : `'${start}T04:45:00'`;
        const to   = endTime   ? `'${end}T${endTime.length === 5 ? endTime + ':00' : endTime}'`     : `'${end}T04:44:00'`;
        return `${field} >= ${from} AND ${field} <= ${to}`;
    }
    return `${field} >= DATEADD(MINUTE,285,CAST(DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(DATEADD(DAY,1,${NOW}) AS DATE) AS DATETIME))`;
}

function pool(res) {
    if (!sqlPool) { res.status(503).json({ success: false, error: 'SQL Server not connected' }); return null; }
    return sqlPool;
}

// ── Weigh Bridge ───────────────────────────────────────────────────────────────
app.get('/api/bangalore/truck-entry', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT CAST([Date] AS DATE) AS Date, TruckNumber, DairyCode, ProductCode,
                DCNumber_Sender, GrossWeight, TareWeight, NetWeight,
                Fat_First, SNF_First, IsCompleted
            FROM BAMUL.dbo.MilkRecipt
            WHERE ${dateCond('CAST([Date] AS DATETIME)+CAST(REPLACE(ArrivalTime,\'.\',\':\') AS DATETIME)', filter, start, end, startTime, endTime)} AND ISNULL(IsDel,0)=0
            ${req.query.all !== 'true' ? "AND ProductCode IN ('RAW MILK','PAST MILK','SKIM MILK','SKIM MILK POWDER','Homogenised milk')" : ''}
            ORDER BY [Date] DESC, ArrivalTime DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Milk Dispatch ──────────────────────────────────────────────────────────────
app.get('/api/bangalore/milk-dispatch-truck', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT CAST([Date] AS DATE) AS Date, TruckNumber, DairyCode, ProductCode, Type,
                GrossWeight, TareWeight, NetWeight, Fat_First, SNF_First, IsCompleted
            FROM BAMUL.dbo.MilkDispatch
            WHERE ${dateCond('CAST([Date] AS DATETIME)+CAST(REPLACE(DispatchTime,\'.\',\':\') AS DATETIME)', filter, start, end, startTime, endTime)} AND ISNULL(IsDel,0)=0 AND IsCompleted=1
            ${req.query.all !== 'true' ? "AND ProductCode IN ('RAW MILK','PAST MILK','SKIM MILK','SKIM MILK POWDER','Homogenised milk')" : ''}
            ORDER BY [Date] DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── RMST ── BAMUL_MIS.dbo.Rec_Batch ───────────────────────────────────────────
// D3: 1=RMST-1, 2=RMST-2, 3=RMST-3, 4=RMST-4, 5=RMST-4A
// D6=TransferredQty, D9=FAT, D10=SNF
app.get('/api/bangalore/rmst', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D3
                    WHEN 1 THEN 'RMST-1' WHEN 2 THEN 'RMST-2'
                    WHEN 3 THEN 'RMST-3' WHEN 4 THEN 'RMST-4'
                    WHEN 5 THEN 'RMST-4A' ELSE CAST(D3 AS VARCHAR)
                END AS RMSID,
                COUNT(*) AS Entries,
                SUM(ISNULL(D6,0)) AS TotalQty,
                ROUND(AVG(NULLIF(D9,0)),2) AS AvgFat,
                ROUND(AVG(NULLIF(D10,0)),2) AS AvgSNF
            FROM BAMUL_MIS.dbo.Rec_Batch
            WHERE ${dateCond('LogTime', filter, start, end, startTime, endTime)}
            GROUP BY D3
            ORDER BY D3
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── RMST Details (all batches) ─────────────────────────────────────────────────
app.get('/api/bangalore/rmst-detail', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                LogTime,
                DATEADD(SECOND,-ISNULL(D7,0),LogTime) AS StartTime,
                D1 AS BayNo,
                CASE D3
                    WHEN 1 THEN 'RMST-1' WHEN 2 THEN 'RMST-2'
                    WHEN 3 THEN 'RMST-3' WHEN 4 THEN 'RMST-4'
                    WHEN 5 THEN 'RMST-4A' ELSE CAST(D3 AS VARCHAR)
                END AS RMSID,
                ISNULL(D6,0) AS TransferredQty,
                D9 AS Fat, D10 AS SNF
            FROM BAMUL_MIS.dbo.Rec_Batch
            WHERE ${dateCond('LogTime', filter, start, end, startTime, endTime)}
            ORDER BY LogTime DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Cream ── BAMUL_MIS.dbo.Batch_Log (D1=12 received, D1=11 sent) ─────────────
// D4=TransferredQty, D6=FAT, D7=SNF
app.get('/api/bangalore/cream', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D1 WHEN 12 THEN 'CBT To CST (Received)' WHEN 11 THEN 'CST To Product Dairy (Sent)' WHEN 10 THEN 'CST To RMST (Sent)' ELSE CAST(D1 AS VARCHAR) END AS LineType,
                COUNT(*) AS Entries,
                SUM(ISNULL(D4,0)) AS TotalQty,
                ROUND(AVG(NULLIF(D6,0)),2) AS AvgFat,
                ROUND(AVG(NULLIF(D7,0)),2) AS AvgSNF
            FROM BAMUL_MIS.dbo.Batch_Log
            WHERE D1 IN (10,11,12)
            AND ${dateCond('LogTime', filter, start, end, startTime, endTime)}
            GROUP BY D1
            ORDER BY D1 DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── PMST ── BAMUL_MIS.dbo.MPL_Batch ───────────────────────────────────────────
// D1=Line(1=MP-01,2=MP-02,3=MP-03,4=MP-04), D2=Source RMST(1-5), D3=Dest PMST(6-11)
// D9=TransferQty, D10=TimeTaken(sec), D11=StartQty, D12=EndQty, D13=Variant
// StartDate=DATEADD(SECOND,-D9,LogTime)
app.get('/api/bangalore/pmst', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D1
                    WHEN 1 THEN 'MP-01' WHEN 2 THEN 'MP-02'
                    WHEN 3 THEN 'MP-03' WHEN 4 THEN 'MP-04'
                    ELSE CAST(D1 AS VARCHAR)
                END AS LineName,
                CASE D3
                    WHEN 6  THEN 'PMST-5'  WHEN 7  THEN 'PMST-6'
                    WHEN 8  THEN 'PMST-7'  WHEN 9  THEN 'PMST-8'
                    WHEN 10 THEN 'PMST-9'  WHEN 11 THEN 'PMST-10'
                    ELSE CAST(D3 AS VARCHAR)
                END AS PMSID,
                CASE D13
                    WHEN 0 THEN 'No Selection'
                    WHEN 1 THEN 'Shubham'       WHEN 2 THEN 'Toned Milk'
                    WHEN 3 THEN 'NSP'            WHEN 4 THEN 'Skim Milk'
                    WHEN 5 THEN 'HCM'            WHEN 6 THEN 'Curd Milk'
                    WHEN 7 THEN 'Npro Milk'      WHEN 8 THEN 'Samruddhi'
                    WHEN 9 THEN 'Full Cream Milk' ELSE 'Unknown'
                END AS Variant,
                COUNT(*) AS Entries,
                SUM(ISNULL(D9,0)) AS TotalProcessed
            FROM BAMUL_MIS.dbo.MPL_Batch
            WHERE ${dateCond('DATEADD(SECOND,-ISNULL(D10,0),LogTime)', filter, start, end, startTime, endTime)}
            GROUP BY D1, D3, D13
            ORDER BY D1, D3, D13
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── HMST ── BAMUL_MIS.dbo.Batch_Log (D1 IN 3,4,5 → PMST Loading Lines) ────────
// D3: 12=HMST-1, 13=HMST-2, 14=HMST-3, 15=HMST-4, 16=HMST-5
// D4=TransferredQty, D6=FAT, D7=SNF, D12=Variant
app.get('/api/bangalore/hmst', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D3
                    WHEN 12 THEN 'HMST-1' WHEN 13 THEN 'HMST-2'
                    WHEN 14 THEN 'HMST-3' WHEN 15 THEN 'HMST-4'
                    WHEN 16 THEN 'HMST-5' ELSE CAST(D3 AS VARCHAR)
                END AS HMSTID,
                CASE D12
                    WHEN 0 THEN 'No Selection'
                    WHEN 1 THEN 'Shubham'       WHEN 2 THEN 'Toned Milk'
                    WHEN 3 THEN 'NSP'            WHEN 4 THEN 'Skim Milk'
                    WHEN 5 THEN 'HCM'            WHEN 6 THEN 'Curd Milk'
                    WHEN 7 THEN 'Npro Milk'      WHEN 8 THEN 'Samruddhi'
                    WHEN 9 THEN 'Full Cream Milk' ELSE 'Unknown'
                END AS Variant,
                COUNT(*) AS Entries,
                SUM(ISNULL(D4,0)) AS TotalQty,
                ROUND(AVG(NULLIF(D6,0)),2) AS AvgFat,
                ROUND(AVG(NULLIF(D7,0)),2) AS AvgSNF
            FROM BAMUL_MIS.dbo.Batch_Log
            WHERE D1 IN (3,4,5) AND D3 IN (12,13,14,15,16)
            AND ${dateCond('DATEADD(SECOND,-ISNULL(D5,0),LogTime)', filter, start, end, startTime, endTime)}
            GROUP BY D3, D12
            ORDER BY D3, D12
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Curd ── BAMUL_MIS.dbo.Curd_Batch ──────────────────────────────────────────
// D1=Line(1=CP-01,2=CP-02), D2=Source PMST(6-11), D3=Dest(17=Curd Tank-1,18=Curd Tank-2)
// D9=TransferQty, D10=Duration(sec), StartDate=DATEADD(SECOND,-D10,LogTime)
app.get('/api/bangalore/curd', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D3
                    WHEN 17 THEN 'Curd Tank-1'
                    WHEN 18 THEN 'Curd Tank-2'
                    ELSE CAST(D3 AS VARCHAR)
                END AS TankID,
                CASE D1 WHEN 1 THEN 'CP-01' WHEN 2 THEN 'CP-02' ELSE CAST(D1 AS VARCHAR) END AS LineName,
                COUNT(*) AS Entries,
                SUM(ISNULL(D9,0)) AS TotalQty
            FROM BAMUL_MIS.dbo.Curd_Batch
            WHERE D3 IN (17,18)
            AND ${dateCond('DATEADD(SECOND,-ISNULL(D10,0),LogTime)', filter, start, end, startTime, endTime)}
            GROUP BY D3, D1
            ORDER BY D3, D1
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Product Dairy Dispatch ── BAMUL_MIS.dbo.Batch_Log (D3 IN 25,40) ──────────
// D4=TransferredQty, D6=FAT, D7=SNF, StartDate=DATEADD(SECOND,-D5,LogTime)
app.get('/api/bangalore/product-dispatch', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D1 WHEN 11 THEN 'CST To Product Dairy' WHEN 13 THEN 'Dispatch Line-1' WHEN 14 THEN 'Dispatch Line-2' ELSE CAST(D1 AS VARCHAR) END AS LineName,
                COUNT(*) AS Entries,
                SUM(ISNULL(D4,0)) AS TotalQty,
                ROUND(AVG(NULLIF(D6,0)),2) AS AvgFat,
                ROUND(AVG(NULLIF(D7,0)),2) AS AvgSNF
            FROM BAMUL_MIS.dbo.Batch_Log
            WHERE D3 IN (25,40)
            AND ${dateCond('DATEADD(SECOND,-ISNULL(D5,0),LogTime)', filter, start, end, startTime, endTime)}
            GROUP BY D1
            ORDER BY D1
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── NMP Dispatch ── BAMUL_MIS.dbo.Batch_Log (D1 IN 13,14 → Dispatch Lines, D3=39 NMP) ──
// D4=TransferredQty, D6=FAT, D7=SNF, StartDate=DATEADD(SECOND,-D5,LogTime)
app.get('/api/bangalore/nmp-dispatch', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT
                CASE D1 WHEN 13 THEN 'Dispatch Line-1' WHEN 14 THEN 'Dispatch Line-2' ELSE CAST(D1 AS VARCHAR) END AS LineName,
                COUNT(*) AS Entries,
                SUM(ISNULL(D4,0)) AS TotalQty,
                ROUND(AVG(NULLIF(D6,0)),2) AS AvgFat,
                ROUND(AVG(NULLIF(D7,0)),2) AS AvgSNF
            FROM BAMUL_MIS.dbo.Batch_Log
            WHERE D1 IN (13,14) AND D3=39
            AND ${dateCond('DATEADD(SECOND,-ISNULL(D5,0),LogTime)', filter, start, end, startTime, endTime)}
            GROUP BY D1
            ORDER BY D1
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Milk Dispatch detail (for dispatch details page) ──────────────────────────
app.get('/api/bangalore/milk-dispatch', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const r = await p.request().query(`
            SELECT DairyCode, ProductCode, LTRIM(RTRIM(ISNULL(Type,''))) AS Type,
                COUNT(*) AS Trucks,
                SUM(ISNULL(NetWeight,0)) AS TotalQty,
                ROUND(AVG(NULLIF(TRY_CAST(Fat_First AS FLOAT),0)),2) AS AvgFat,
                ROUND(AVG(NULLIF(TRY_CAST(SNF_First AS FLOAT),0)),2) AS AvgSNF,
                SUM(CASE WHEN IsCompleted=1 THEN 1 ELSE 0 END) AS Completed
            FROM BAMUL.dbo.MilkDispatch
            WHERE ${dateCond('[Date]', filter, start, end, startTime, endTime, true)} AND ISNULL(IsDel,0)=0
            GROUP BY DairyCode, ProductCode, LTRIM(RTRIM(ISNULL(Type,'')))
            ORDER BY DairyCode, ProductCode
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Milk Procurement Summary (for milk-usage-products page) ─────────────────
app.get('/api/bangalore/milk-procurement-summary', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, startTime, endTime } = req.query;
        const recv = await p.request().query(`
            SELECT SUM(ISNULL(NetWeight,0)) AS TotalReceived
            FROM BAMUL.dbo.MilkRecipt
            WHERE ${dateCond('[Date]', filter, start, end, startTime, endTime, true)} AND ISNULL(IsDel,0)=0
        `);
        const disp = await p.request().query(`
            SELECT LTRIM(RTRIM(ISNULL(Type,''))) AS Type,
                SUM(ISNULL(NetWeight,0)) AS TotalQty
            FROM BAMUL.dbo.MilkDispatch
            WHERE ${dateCond('[Date]', filter, start, end, startTime, endTime, true)} AND ISNULL(IsDel,0)=0
            GROUP BY LTRIM(RTRIM(ISNULL(Type,'')))
        `);
        res.json({ success: true, totalReceived: recv.recordset[0].TotalReceived || 0, byType: disp.recordset });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── AI Production ── BAMUL.dbo.AI_SalesEntry + AI_Variants ──────────────────
// entry_date is a date-only column; milk = non-curd variants, curd = variants named 'Curd%'
app.get('/api/bangalore/ai-production', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end } = req.query;
        const NOW = 'DATEADD(MINUTE,330,GETDATE())';
        let whereClause;
        if (filter === 'yesterday') whereClause = `entry_date = CAST(DATEADD(DAY,-1,${NOW}) AS DATE)`;
        else if (filter === 'today') whereClause = `entry_date = CAST(${NOW} AS DATE)`;
        else if (filter === 'week')  whereClause = `entry_date >= CAST(DATEADD(DAY,1-DATEPART(WEEKDAY,${NOW}),${NOW}) AS DATE) AND entry_date <= CAST(${NOW} AS DATE)`;
        // Custom range uses a 04:45→04:44 dairy-day window: "start .. end" means
        // dairy-days from start up to (end - 1 day), because the end date is only
        // the 04:44 morning boundary. entry_date is date-only, so map accordingly:
        // curd/AI entry_date should span [start, end) — i.e. exclude the end date,
        // matching the single-dairy-day behaviour of the SCADA stages.
        else if (filter === 'custom' && start && end) whereClause = `entry_date >= '${start}' AND entry_date < '${end}'`;
        else whereClause = `entry_date >= DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AND entry_date <= CAST(${NOW} AS DATE)`;
        const r = await p.request().query(`
            SELECT
                SUM(CASE WHEN v.name LIKE 'Curd%' THEN 0 ELSE e.total_litres END) AS milkKg,
                SUM(CASE WHEN v.name LIKE 'Curd%' THEN 0 ELSE e.produced_ai_with_correction END) AS milkPkts,
                SUM(CASE WHEN v.name LIKE 'Curd%' THEN e.total_litres ELSE 0 END) AS curdKg,
                SUM(CASE WHEN v.name LIKE 'Curd%' THEN e.produced_ai_with_correction ELSE 0 END) AS curdPkts
            FROM BAMUL.dbo.AI_SalesEntry e
            JOIN BAMUL.dbo.AI_Variants v ON e.variant_id = v.id
            WHERE ${whereClause}
        `);
        const row = r.recordset[0];
        res.json({ success: true, milkKg: row.milkKg || 0, milkPkts: row.milkPkts || 0, curdKg: row.curdKg || 0, curdPkts: row.curdPkts || 0 });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Milk Movement Summary ─────────────────────────────────────────────────────
// ?filter=month|week|yesterday|custom&start=YYYY-MM-DD&end=YYYY-MM-DD&group=day|week|month
app.get('/api/bangalore/milk-movement', async (req, res) => {
    try {
        const p = pool(res); if (!p) return;
        const { filter, start, end, group } = req.query;

        const recvCond = dateCond(`CAST([Date] AS DATETIME)+CAST(REPLACE(ArrivalTime,'.',':') AS DATETIME)`, filter, start, end, null, null, false);
        const dispCond = dateCond(`CAST([Date] AS DATETIME)+CAST(REPLACE(DispatchTime,'.',':') AS DATETIME)`, filter, start, end, null, null, false);

        const netWt = `CASE WHEN ISNULL(NetWeight,0)>0 THEN NetWeight ELSE ISNULL(GrossWeight,0)-ISNULL(TareWeight,0) END`;
        const recvDt = `CAST([Date] AS DATETIME)+CAST(REPLACE(ArrivalTime,'.',':') AS DATETIME)`;
        const dispDt = `CAST([Date] AS DATETIME)+CAST(REPLACE(DispatchTime,'.',':') AS DATETIME)`;

        if (group === 'day' || group === 'week') {
            // Group by the shifted date (day starts at 04:45)
            // For week grouping: 0-based chunk from 1st of month (days 1-7 = week 0, 8-14 = week 1, etc)
            const monthStart = `DATEFROMPARTS(YEAR(DATEADD(MINUTE,-285,${recvDt})),MONTH(DATEADD(MINUTE,-285,${recvDt})),1)`;
            const monthStartD = `DATEFROMPARTS(YEAR(DATEADD(MINUTE,-285,${dispDt})),MONTH(DATEADD(MINUTE,-285,${dispDt})),1)`;
            const recvGrp = group === 'day'
                ? `CAST(DATEADD(MINUTE,-285,${recvDt}) AS DATE)`
                : `DATEDIFF(DAY,${monthStart},CAST(DATEADD(MINUTE,-285,${recvDt}) AS DATE))/7`;
            const dispGrp = group === 'day'
                ? `CAST(DATEADD(MINUTE,-285,${dispDt}) AS DATE)`
                : `DATEDIFF(DAY,${monthStartD},CAST(DATEADD(MINUTE,-285,${dispDt}) AS DATE))/7`;

            const [recvQ, dispQ] = await Promise.all([
                p.request().query(`
                    SELECT ${recvGrp} AS grp,
                        MIN(CAST(DATEADD(MINUTE,-285,${recvDt}) AS DATE)) AS StartDate,
                        MAX(CAST(DATEADD(MINUTE,-285,${recvDt}) AS DATE)) AS EndDate,
                        SUM(${netWt}) AS TotalReceived, COUNT(*) AS Trucks
                    FROM BAMUL.dbo.MilkRecipt
                    WHERE ${recvCond} AND ISNULL(IsDel,0)=0
                    AND ProductCode IN ('RAW MILK','PAST MILK','SKIM MILK','SKIM MILK POWDER','Homogenised milk')
                    GROUP BY ${recvGrp} ORDER BY MIN(${recvDt})`),
                p.request().query(`
                    SELECT ${dispGrp} AS grp,
                        SUM(${netWt}) AS TotalDispatched, COUNT(*) AS Trucks
                    FROM BAMUL.dbo.MilkDispatch
                    WHERE ${dispCond} AND ISNULL(IsDel,0)=0 AND IsCompleted=1
                    AND ProductCode IN ('RAW MILK','PAST MILK','SKIM MILK','SKIM MILK POWDER','Homogenised milk')
                    GROUP BY ${dispGrp} ORDER BY MIN(${dispDt})`)
            ]);

            const recvMap = {}, dispMap = {};
            recvQ.recordset.forEach(r => { recvMap[String(r.grp)] = r; });
            dispQ.recordset.forEach(r => { dispMap[String(r.grp)] = r; });

            const allKeys = [...new Set([...Object.keys(recvMap), ...Object.keys(dispMap)])].sort();

            const rows = allKeys.map(k => {
                const rv = recvMap[k] || {}, dv = dispMap[k] || {};
                const received = rv.TotalReceived || 0;
                const dispatched = dv.TotalDispatched || 0;
                return {
                    grp: k,
                    startDate: rv.StartDate || null,
                    endDate: rv.EndDate || null,
                    received,
                    receivedTrucks: rv.Trucks || 0,
                    usedInProduction: Math.max(0, received - dispatched),
                    dispatched,
                    dispatchedTrucks: dv.Trucks || 0
                };
            });

            const totals = rows.reduce((a, r) => {
                a.received += r.received; a.receivedTrucks += r.receivedTrucks;
                a.usedInProduction += r.usedInProduction;
                a.dispatched += r.dispatched; a.dispatchedTrucks += r.dispatchedTrucks;
                return a;
            }, { received:0, receivedTrucks:0, usedInProduction:0, dispatched:0, dispatchedTrucks:0 });

            return res.json({ success: true, rows, totals });
        } else {
            // single aggregate (month / yesterday / custom with no group)
            const [recvQ, dispQ] = await Promise.all([
                p.request().query(`SELECT SUM(${netWt}) AS TotalReceived, COUNT(*) AS Trucks FROM BAMUL.dbo.MilkRecipt WHERE ${recvCond} AND ISNULL(IsDel,0)=0 AND ProductCode IN ('RAW MILK','PAST MILK','SKIM MILK','SKIM MILK POWDER','Homogenised milk')`),
                p.request().query(`SELECT SUM(${netWt}) AS TotalDispatched, COUNT(*) AS Trucks FROM BAMUL.dbo.MilkDispatch WHERE ${dispCond} AND ISNULL(IsDel,0)=0 AND IsCompleted=1 AND ProductCode IN ('RAW MILK','PAST MILK','SKIM MILK','SKIM MILK POWDER','Homogenised milk')`)
            ]);
            const rv = recvQ.recordset[0], dv = dispQ.recordset[0];
            const received = rv.TotalReceived || 0;
            const dispatched = dv.TotalDispatched || 0;
            return res.json({ success: true, rows: [], totals: {
                received, receivedTrucks: rv.Trucks || 0,
                usedInProduction: Math.max(0, received - dispatched),
                dispatched, dispatchedTrucks: dv.Trucks || 0
            }});
        }
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── BMC / CC — Oracle RM_SHIPPING_HDR ──────────────────────────────────────────────────
app.get('/api/bangalore/bmc-cc', async (req, res) => {
    try {
        const { filter, start, end } = req.query;
        let dateCond;
        if (filter === 'yesterday') {
            dateCond = `SHIPPED_DATE >= TRUNC(SYSDATE)-1 AND SHIPPED_DATE < TRUNC(SYSDATE)`;
        } else if (filter === 'week') {
            dateCond = `SHIPPED_DATE >= TRUNC(SYSDATE) - 7 AND SHIPPED_DATE < TRUNC(SYSDATE)`;
        } else if (filter === 'month') {
            dateCond = `SHIPPED_DATE >= TRUNC(SYSDATE,'MM') AND SHIPPED_DATE < TRUNC(SYSDATE)+1`;
        } else if (filter === 'custom' && start && end) {
            dateCond = `SHIPPED_DATE >= TO_DATE('${start}','YYYY-MM-DD') AND SHIPPED_DATE < TO_DATE('${end}','YYYY-MM-DD')+1`;
        } else {
            dateCond = `SHIPPED_DATE >= TRUNC(SYSDATE)-1 AND SHIPPED_DATE < TRUNC(SYSDATE)`;
        }
        const conn = await oraclePool();
        const result = await conn.execute(
            `SELECT SHIPPED_DATE, RECEIPT_SOURCE_CODE, VENDOR_NAME, ROUTE_NO,
                NET_WEIGHT, QUANTITY_SHIPPED, AVG_FAT, AVG_SNF, TEMPERATURE, RECEIPT_STATUS
             FROM BMLCUSTM2.RM_SHIPPING_HDR
             WHERE RECEIPT_SOURCE_CODE LIKE 'RMRD%'
             AND ${dateCond}
             ORDER BY SHIPPED_DATE DESC`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await conn.close();
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => console.log(`Bangalore Dairy API running on port ${PORT}`));
