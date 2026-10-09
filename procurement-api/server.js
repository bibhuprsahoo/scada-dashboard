const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const path = require('path');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
        if (filter === 'week')      return `CAST(${field} AS DATE) >= CAST(DATEADD(DAY,2-DATEPART(WEEKDAY,${NOW}),${NOW}) AS DATE) AND CAST(${field} AS DATE) <= CAST(GETDATE() AS DATE)`;
        if (filter === 'month')     return `CAST(${field} AS DATE) >= DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AND CAST(${field} AS DATE) <= CAST(${NOW} AS DATE)`;
        if (filter === 'custom' && start && end) return `CAST(${field} AS DATE) >= '${start}' AND CAST(${field} AS DATE) <= '${end}'`;
        return `CAST(${field} AS DATE) >= DATEFROMPARTS(YEAR(${NOW}),MONTH(${NOW}),1) AND CAST(${field} AS DATE) <= CAST(${NOW} AS DATE)`;
    }
    // Full datetime: 04:45 dairy shift
    if (filter === 'today')     return `${field} >= DATEADD(MINUTE,285,CAST(CAST(${NOW} AS DATE) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(DATEADD(DAY,1,${NOW}) AS DATE) AS DATETIME))`;
    if (filter === 'yesterday') return `${field} >= DATEADD(MINUTE,285,CAST(CAST(DATEADD(DAY,-1,${NOW}) AS DATE) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(${NOW} AS DATE) AS DATETIME))`;
    if (filter === 'week')      return `${field} >= DATEADD(MINUTE,285,CAST(CAST(DATEADD(DAY,2-DATEPART(WEEKDAY,${NOW}),${NOW}) AS DATE) AS DATETIME)) AND ${field} < DATEADD(MINUTE,284,CAST(CAST(DATEADD(DAY,1,${NOW}) AS DATE) AS DATETIME))`;
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
        else if (filter === 'week')  whereClause = `entry_date >= CAST(DATEADD(DAY,2-DATEPART(WEEKDAY,${NOW}),${NOW}) AS DATE) AND entry_date <= CAST(${NOW} AS DATE)`;
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


const PORT = process.env.PORT || 3000;


// ── UNION_054 MySQL connection ─────────────────────────────────────────────────
const mysql2 = require('mysql2/promise');
const mysqlCfg = { host:'127.0.0.1', port:3306, user:'shibashish', password:'ShibStrongPass#2026', database:'UNION_054' };

function getMonthRanges(n=3){
  const ranges=[], now=new Date();
  for(let i=n-1;i>=0;i--){
    const s=new Date(now.getFullYear(),now.getMonth()-i,1);
    const e=new Date(now.getFullYear(),now.getMonth()-i+1,0);        // last day of month
    const nx=new Date(now.getFullYear(),now.getMonth()-i+1,1);       // first day of NEXT month (exclusive upper bound)
    // endExcl is used with a half-open range (>= start AND < endExcl). The old
    // `end` (bare last-day date) with BETWEEN dropped the final day's rows because
    // collection_date is a datetime (e.g. '...31 16:00' > '...31 00:00'). Kept for
    // reference but queries should use start/endExcl.
    ranges.push({ label:s.toLocaleString('en-IN',{month:'short',year:'2-digit'}), days:e.getDate(),
      start:s.toISOString().split('T')[0], end:e.toISOString().split('T')[0],
      endExcl:nx.toISOString().split('T')[0] });
  }
  return ranges;
}
function getLast90(){
  const d=[], now=new Date();
  for(let i=89;i>=0;i--){ const x=new Date(now); x.setDate(x.getDate()-i); d.push(x.toISOString().split('T')[0]); }
  return d;
}

let procurementCache = null;
let procurementCacheTime = 0;
let procurementCacheBuilding = false;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function buildProcurementCache() {
  if(procurementCacheBuilding) return;
  procurementCacheBuilding = true;
  let c;
  try {
    c = await mysql2.createConnection(mysqlCfg);
    const months = getMonthRanges(3);
    const last90 = getLast90();

    // Per-taluk auto weight from tbl_milk_collection grouped by dcs_code (no join — uses idx_dcs_daily_full)
    const talukAutoWeight = await Promise.all(months.map(async m => {
      const [r] = await c.query(
        'SELECT dcs_code, SUM(CASE WHEN is_quantity_auto=1 THEN quantity ELSE 0 END) AS autoQty FROM tbl_milk_collection WHERE collection_date >= ? AND collection_date < ? AND is_delete=0 GROUP BY dcs_code',
        [m.start, m.endExcl]);
      return r;
    }));

    // Monthly taluk aggregates
    const talukMonthly = await Promise.all(months.map(async m => {
      const [r] = await c.query(`
        SELECT s.sub_district_name AS taluk,
          SUM(a.quantity) AS purchase,
          SUM(a.kg_fat)*100/NULLIF(SUM(a.quantity),0) AS avgFat,
          SUM(a.kg_snf)*100/NULLIF(SUM(a.quantity),0) AS avgSnf,
          SUM(a.member_count) AS measurements,
          COUNT(DISTINCT a.dcs_code) AS mpcs
        FROM tbl_aggregation_data a
        JOIN tbl_dcs d ON a.dcs_code=d.dcs_code AND d.is_delete=0
        JOIN tbl_sub_districts s ON d.sub_district_code=s.sub_district_code
        WHERE a.table_name='tbl_milk_collection'
          AND a.collection_date >= ? AND a.collection_date < ? AND a.collection_date<=NOW()
        GROUP BY s.sub_district_name ORDER BY purchase DESC
      `, [m.start, m.endExcl]);
      return r;
    }));

    // Monthly union aggregates
    const unionMonthly = await Promise.all(months.map(async m => {
      // Purchase / fat / snf / measurements from milk collection rows only
      const [r] = await c.query(`
        SELECT SUM(a.quantity) AS purchase,
          SUM(a.kg_fat)*100/NULLIF(SUM(a.quantity),0) AS avgFat,
          SUM(a.kg_snf)*100/NULLIF(SUM(a.quantity),0) AS avgSnf,
          SUM(a.member_count) AS measurements
        FROM tbl_aggregation_data a
        WHERE a.table_name='tbl_milk_collection'
          AND a.collection_date >= ? AND a.collection_date < ? AND a.collection_date<=NOW()
      `, [m.start, m.endExcl]);
      // Local sale from aggregation (real)
      const [ls] = await c.query(`
        SELECT SUM(a.quantity) AS localSale
        FROM tbl_aggregation_data a
        WHERE a.table_name='tbl_local_milk_sale'
          AND a.collection_date >= ? AND a.collection_date < ? AND a.collection_date<=NOW()
      `, [m.start, m.endExcl]);
      // Auto vs manual weight from raw milk_collection (uses idx_date_auto_qty)
      const [aw] = await c.query(`
        SELECT
          SUM(CASE WHEN is_quantity_auto=1 THEN quantity ELSE 0 END) AS autoWeightQty,
          SUM(CASE WHEN is_quantity_auto=0 THEN quantity ELSE 0 END) AS manualWeightQty
        FROM tbl_milk_collection
        WHERE collection_date >= ? AND collection_date < ? AND collection_date<=NOW()
      `, [m.start, m.endExcl]);
      return {
        ...r[0],
        localSale: ls[0].localSale,
        autoWeightQty: aw[0].autoWeightQty,
        manualWeightQty: aw[0].manualWeightQty
      };
    }));

    // Daily wire (last 90 days)
    // NOTE: must filter table_name='tbl_milk_collection' — tbl_aggregation_data
    // also holds dispatch/receipt/local-sale/product-sale rows. Without this the
    // daily series (which drives the weekly & daily columns) double-counts those
    // categories and inflates purchase ~2x. Matches the monthly union query above.
    const [dailyRows] = await c.query(`
      SELECT DATE(a.collection_date) AS ds,
        SUM(a.quantity) AS qty,
        SUM(a.kg_fat)*100/NULLIF(SUM(a.quantity),0) AS fat,
        SUM(a.kg_snf)*100/NULLIF(SUM(a.quantity),0) AS snf
      FROM tbl_aggregation_data a
      WHERE a.table_name='tbl_milk_collection'
        AND a.collection_date BETWEEN ? AND ? AND a.collection_date<=NOW()
      GROUP BY DATE(a.collection_date) ORDER BY ds
    `, [last90[0], last90[last90.length-1]]);

    // Daily auto weight share from tbl_milk_collection
    const [autoRows] = await c.query(`
      SELECT DATE(collection_date) AS ds,
        SUM(CASE WHEN is_quantity_auto=1 THEN quantity ELSE 0 END)*100/NULLIF(SUM(quantity),0) AS autoShare
      FROM tbl_milk_collection
      WHERE collection_date BETWEEN ? AND ? AND collection_date<=NOW()
      GROUP BY DATE(collection_date) ORDER BY ds
    `, [last90[0], last90[last90.length-1]]);
    const autoMap = {};
    autoRows.forEach(r => { autoMap[r.ds.toISOString().split('T')[0]] = parseFloat(r.autoShare)||0; });

    // Daily per-taluk wire (same table_name filter — collection rows only)
    const [talukDailyRows] = await c.query(`
      SELECT sd.sub_district_name AS taluk, DATE(a.collection_date) AS ds, SUM(a.quantity) AS qty
      FROM tbl_aggregation_data a
      JOIN tbl_dcs d ON a.dcs_code=d.dcs_code AND d.is_delete=0
      JOIN tbl_sub_districts sd ON d.sub_district_code=sd.sub_district_code
      WHERE a.table_name='tbl_milk_collection'
        AND a.collection_date BETWEEN ? AND ? AND a.collection_date<=NOW()
      GROUP BY sd.sub_district_name, DATE(a.collection_date) ORDER BY ds
    `, [last90[0], last90[last90.length-1]]);
    const talukDailyMap = {};
    talukDailyRows.forEach(r => {
      const t = r.taluk; const d = r.ds.toISOString().split('T')[0];
      if(!talukDailyMap[t]) talukDailyMap[t]={};
      talukDailyMap[t][d] = parseFloat(r.qty)||0;
    });
    const talukDaily = {};
    Object.keys(talukDailyMap).forEach(t => {
      talukDaily[t] = last90.map(d => talukDailyMap[t][d]||0);
    });

    const dmap = {};
    dailyRows.forEach(r => { dmap[r.ds.toISOString().split('T')[0]] = r; });
    const wireQty = last90.map(d => parseFloat(dmap[d]?.qty)||0);
    const wireFat = last90.map(d => parseFloat(dmap[d]?.fat)||0);
    const wireSnf = last90.map(d => parseFloat(dmap[d]?.snf)||0);
    const wireAuto = last90.map(d => autoMap[d]||0);

    const weekly = [];
    for(let i=0;i+7<=last90.length;i+=7)
      weekly.push({s:i,e:i+7,v:wireQty.slice(i,i+7).reduce((a,b)=>a+b,0)});

    const monthStarts=[], monthDays=[];
    last90.forEach((d,i)=>{ if(d.slice(8)==='01') monthStarts.push(i); });
    monthStarts.forEach((s,i)=>{ monthDays.push((monthStarts[i+1]||last90.length)-s); });

    // Top MPCS with month-over-month change
    const cur = months[2];
    const prv = months[1];
    const [mpcsRows] = await c.query(`
      SELECT s.sub_district_name AS taluk, d.dcs_name AS name, d.dcs_code,
        SUM(a.quantity) AS qty,
        SUM(a.kg_fat)*100/NULLIF(SUM(a.quantity),0) AS avgFat,
        SUM(a.quantity)/? AS perDay
      FROM tbl_aggregation_data a
      JOIN tbl_dcs d ON a.dcs_code=d.dcs_code AND d.is_delete=0
      JOIN tbl_sub_districts s ON d.sub_district_code=s.sub_district_code
      WHERE a.table_name='tbl_milk_collection'
        AND a.collection_date >= ? AND a.collection_date < ? AND a.collection_date<=NOW()
      GROUP BY a.dcs_code,d.dcs_name,s.sub_district_name
      ORDER BY qty DESC LIMIT 40
    `, [cur.days, cur.start, cur.endExcl]);
    const [mpcsPrvRows] = await c.query(`
      SELECT a.dcs_code, SUM(a.quantity) AS qty
      FROM tbl_aggregation_data a
      WHERE a.table_name='tbl_milk_collection'
        AND a.collection_date >= ? AND a.collection_date < ? AND a.collection_date<=NOW()
      GROUP BY a.dcs_code
    `, [prv.start, prv.endExcl]);
    const mpcsPrvMap = {};
    mpcsPrvRows.forEach(r => { mpcsPrvMap[r.dcs_code] = parseFloat(r.qty)||0; });

    // App counts — type 1 = Farmer app, type 3 = Secretary app (verified against OCI)
    const [appR] = await c.query(`
      SELECT COUNT(DISTINCT CASE WHEN type=1 THEN code END) AS farmerApp,
             COUNT(DISTINCT CASE WHEN type=3 THEN code END) AS secretaryApp
      FROM tbl_app_activation WHERE is_active=1
    `);

    // Per-taluk local sale, per month (real, from aggregation)
    const talukLocalSale = await Promise.all(months.map(async m => {
      const [r] = await c.query(`
        SELECT s.sub_district_name AS taluk, SUM(a.quantity) AS localSale
        FROM tbl_aggregation_data a
        JOIN tbl_dcs d ON a.dcs_code=d.dcs_code AND d.is_delete=0
        JOIN tbl_sub_districts s ON d.sub_district_code=s.sub_district_code
        WHERE a.table_name='tbl_local_milk_sale'
          AND a.collection_date >= ? AND a.collection_date < ? AND a.collection_date<=NOW()
        GROUP BY s.sub_district_name
      `, [m.start, m.endExcl]);
      const map={}; r.forEach(x=>map[x.taluk]=parseFloat(x.localSale)||0); return map;
    }));

    // Build dcs_code -> sub_district_code map for auto weight aggregation
    const [dcsRows] = await c.query('SELECT dcs_code, sub_district_code FROM tbl_dcs WHERE is_delete=0');
    const dcsToSubDistrict = {};
    dcsRows.forEach(r => { dcsToSubDistrict[r.dcs_code] = r.sub_district_code; });
    // sub_district_code -> taluk name map (from PD_TALUKS reversed)
    const subDistrictToTaluk = {
      '05545':'Anekal','05544':'Bangalore East','05542':'Bangalore North',
      '05543':'Bangalore South','05607':'Channapatna','05603':'Devanahalli',
      '05602':'Dod Ballapur','05604':'Hosakote','05608':'Kanakapura',
      '05605':'Magadi','05601':'Nelamangala','05606':'Ramanagara'
    };
    // Aggregate auto weight per taluk per month
    const talukAutoMap = talukAutoWeight.map(monthRows => {
      const m = {};
      monthRows.forEach(r => {
        const taluk = subDistrictToTaluk[dcsToSubDistrict[r.dcs_code]];
        if (taluk) m[taluk] = (m[taluk]||0) + (parseFloat(r.autoQty)||0);
      });
      return m;
    });

    // Build taluks
    const names = [...new Set(talukMonthly.flatMap(m=>m.map(t=>t.taluk)))].sort();
    const taluks = names.map(name => {
      const bm = months.map((_,i) => talukMonthly[i].find(t=>t.taluk===name)||{});
      const purchase = bm.map(t=>parseFloat(t.purchase)||0);
      const avgFat   = bm.map(t=>parseFloat(t.avgFat)||0);
      const avgSnf   = bm.map(t=>parseFloat(t.avgSnf)||0);
      const measurements = bm.map(t=>parseInt(t.measurements)||0);
      const chgMoM = purchase[1] ? (purchase[2]-purchase[1])/purchase[1]*100 : 0;
      // Real per-taluk local sale; net = purchase − local sale
      const localSale = months.map((_,i)=>talukLocalSale[i][name]||0);
      const netPurchase = purchase.map((v,i)=>v-(localSale[i]||0));
      // Auto/manual split: real per-taluk auto weight from tbl_milk_collection
      return { name, purchase, avgFat, avgSnf, measurements,
        autoWeightQty: bm.map((_,i) => talukAutoMap[i][name]||0),
        manualWeightQty: purchase.map((v,i) => v - (talukAutoMap[i][name]||0)),
        localSale, sampleMilk: months.map(()=>null),
        netPurchase,
        farmerApp:[0,0,0], secretaryApp:[0,0,0],
        chg:{daily:chgMoM, weekly:chgMoM, custom:chgMoM}
      };
    });

    const union = {
      purchase:    unionMonthly.map(u=>parseFloat(u.purchase)||0),
      avgFat:      unionMonthly.map(u=>parseFloat(u.avgFat)||0),
      avgSnf:      unionMonthly.map(u=>parseFloat(u.avgSnf)||0),
      measurements:unionMonthly.map(u=>parseInt(u.measurements)||0),
      // Real values from OCI (no more ratio estimates)
      autoWeightQty:  unionMonthly.map(u=>parseFloat(u.autoWeightQty)||0),
      manualWeightQty:unionMonthly.map(u=>parseFloat(u.manualWeightQty)||0),
      localSale:   unionMonthly.map(u=>parseFloat(u.localSale)||0),
      // Sample Milk: no source table in OCI — not available (was a fake 0.7% estimate)
      sampleMilk:  unionMonthly.map(()=>null),
      // Net purchase = gross purchase − local sale (real)
      netPurchase: unionMonthly.map(u=>(parseFloat(u.purchase)||0)-(parseFloat(u.localSale)||0)),
      farmerApp:   [appR[0].farmerApp,appR[0].farmerApp,appR[0].farmerApp],
      secretaryApp:[appR[0].secretaryApp,appR[0].secretaryApp,appR[0].secretaryApp],
    };

    const payload = { success:true, data:{
      periods: months.map(m=>({label:m.label,days:m.days})),
      periodName: months[2].label,
      union, taluks,
      weightBuckets:[{label:'Grand Total',counts:[taluks.length,taluks.length,taluks.length]}],
      fatBuckets:   [{label:'Grand Total',counts:[taluks.length,taluks.length,taluks.length]}],
      mpcs: mpcsRows.map(r=>{
        const curQty=parseFloat(r.qty)||0;
        const prvQty=mpcsPrvMap[r.dcs_code]||0;
        const chgMoM=prvQty?(curQty-prvQty)/prvQty*100:0;
        return {taluk:r.taluk,name:r.name,qty:curQty,avgFat:parseFloat(r.avgFat)||0,perDay:parseFloat(r.perDay)||0,chg:{daily:chgMoM,weekly:chgMoM,monthly:chgMoM,custom:chgMoM}};
      }),
      wire:{ dates:last90, dailyAll:wireQty, fatAll:wireFat, snfAll:wireSnf,
        autoAll:wireAuto, weekly, monthStarts, monthDays,
        talukDaily,
        farmerAppCum:last90.map(()=>appR[0].farmerApp||0),
        secAppCum:last90.map(()=>appR[0].secretaryApp||0),
        netRatio:0.975, measRatio:0.113 }
    }};
    procurementCache = payload;
    procurementCacheTime = Date.now();
    procurementCacheBuilding = false;
    console.log('Procurement cache refreshed at', new Date().toISOString());
  } catch(err) {
    procurementCacheBuilding = false;
    console.error('Cache build error:', err.message);
  } finally {
    if(c) await c.end();
  }
}

app.get('/api/bangalore/union054/procurement', async (req, res) => {
  // if cache is stale, trigger background refresh but still serve stale data
  if(procurementCache && (Date.now()-procurementCacheTime) >= CACHE_TTL) {
    buildProcurementCache(); // background refresh
  }
  // serve from cache if available
  if(procurementCache) return res.json(procurementCache);
  // no cache yet — wait for first build
  await buildProcurementCache();
  res.json(procurementCache);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PreDairy dashboards — Digital Transformation + Farmer Engagement
// Serves predairy/digital.html and predairy/farmers.html.
// Reuses the UNION_054 credentials above (mysqlCfg); adds a small pool.
//
// Query design: tbl_milk_collection is large and partitioned by
// YEAR/MONTH(collection_date). Comparisons use a half-open datetime range so
// partition pruning and the collection_date index both apply; DATE() wrappers
// would disable both. The fact table is aggregated one day at a time and
// dcs_code -> taluk is mapped in JS (tbl_dcs is only ~2,300 rows), because
// joining tbl_dcs into the fact query is far slower. One query per calendar
// day, cached: a past day is immutable (24h TTL); today refreshes every 5 min.
// ═══════════════════════════════════════════════════════════════════════════════
const pdPool = mysql2.createPool({
  ...mysqlCfg,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.PROC_POOL_SIZE || '8', 10),
  connectTimeout: 20000,
  dateStrings: true,
  decimalNumbers: true,
});
const PD_QUERY_TIMEOUT_MS = parseInt(process.env.PROC_QUERY_TIMEOUT_MS || '180000', 10);
const PD_POOL_SIZE = parseInt(process.env.PROC_POOL_SIZE || '8', 10);

async function pdQ(sql, params = []) {
  const [rows] = await pdPool.query({ sql, values: params, timeout: PD_QUERY_TIMEOUT_MS });
  return rows;
}

// ── tiny TTL cache ─────────────────────────────────────────────────────────────
const PD_CACHE_TTL = 5 * 60 * 1000;         // live data
const PD_CLOSED_TTL = 24 * 60 * 60 * 1000;  // completed periods
const PD_MAX_DAYS = 400;
const pdCache = new Map();       // key -> { at, value }
const pdDayCache = new Map();    // 'YYYY-MM-DD' -> { at, value }
const pdInflight = new Map();    // key -> Promise

function pdCacheGet(store, key, ttl) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return undefined;
}
function pdCacheSet(store, key, value) { store.set(key, { at: Date.now(), value }); }
function pdOnce(key, fn) {
  if (pdInflight.has(key)) return pdInflight.get(key);
  const p = fn().finally(() => pdInflight.delete(key));
  pdInflight.set(key, p);
  return p;
}

// ── date helpers (UTC, no TZ drift) ─────────────────────────────────────────────
const pdPad = n => String(n).padStart(2, '0');
const pdIso = d => `${d.getUTCFullYear()}-${pdPad(d.getUTCMonth() + 1)}-${pdPad(d.getUTCDate())}`;
const pdParseDay = s => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const pdTodayISO = () => pdIso(new Date());
function pdAddDays(isoStr, n) { const d = pdParseDay(isoStr); d.setUTCDate(d.getUTCDate() + n); return pdIso(d); }
function pdDayList(fromDate, toDate) {
  let f = pdParseDay(fromDate), t = pdParseDay(toDate);
  if (t < f) { const tmp = f; f = t; t = tmp; }
  const span = Math.min(Math.round((t - f) / 86400000) + 1, PD_MAX_DAYS);
  const out = [];
  for (let i = 0; i < span; i++) out.push(pdAddDays(pdIso(f), i));
  return out;
}

// ── SQL: one pass over a day's partition, grouped by society ─────────────────────
const PD_DAY_SQL = `
SELECT
  dcs_code,
  SUM(quantity)                                              AS qty,
  SUM(CASE WHEN is_quantity_auto=1 THEN quantity ELSE 0 END)  AS auto_qty,
  COUNT(*)                                                    AS entries,
  SUM(CASE WHEN is_quantity_auto=1 THEN 1 ELSE 0 END)         AS auto_w_cnt,
  SUM(CASE WHEN is_quantity_auto=0 THEN 1 ELSE 0 END)         AS man_w_cnt,
  SUM(CASE WHEN is_quality_auto=1  THEN 1 ELSE 0 END)         AS auto_f_cnt,
  SUM(CASE WHEN is_quality_auto=0  THEN 1 ELSE 0 END)         AS man_f_cnt
FROM tbl_milk_collection
WHERE collection_date >= ? AND collection_date < ? AND is_delete=0
GROUP BY dcs_code`;

const PD_TALUKS = {
  'Anekal': '05545', 'Bangalore East': '05544', 'Bangalore North': '05542',
  'Bangalore South': '05543', 'Channapatna': '05607', 'Devanahalli': '05603',
  'Dod Ballapur': '05602', 'Hosakote': '05604', 'Kanakapura': '05608',
  'Magadi': '05605', 'Nelamangala': '05601', 'Ramanagara': '05606',
};
const PD_CODE_TO_TALUK = Object.fromEntries(Object.entries(PD_TALUKS).map(([k, v]) => [v, k]));

async function pdDcsTalukMap() {
  const hit = pdCacheGet(pdCache, 'dcsmap', 60 * 60 * 1000);
  if (hit) return hit;
  return pdOnce('dcsmap', async () => {
    const rows = await pdQ('SELECT dcs_code, sub_district_code FROM tbl_dcs WHERE is_active=1 AND is_delete=0');
    const m = new Map();
    for (const r of rows) {
      const t = PD_CODE_TO_TALUK[String(r.sub_district_code)];
      if (t) m.set(r.dcs_code, t);
    }
    pdCacheSet(pdCache, 'dcsmap', m);
    return m;
  });
}

async function pdFetchDay(day) {
  // A past day is normally immutable (24h TTL). But an EMPTY result is treated
  // as short-lived even for a past date: a day that rolls from "today" to
  // "past" before its collection has fully landed would otherwise be frozen
  // empty for 24h. Empty days re-check every PD_CACHE_TTL so they self-heal
  // once the data arrives.
  const ttlFor = value =>
    (day < pdTodayISO() && value && value.size > 0) ? PD_CLOSED_TTL : PD_CACHE_TTL;
  const hitEntry = pdDayCache.get(day);
  if (hitEntry && Date.now() - hitEntry.at < ttlFor(hitEntry.value)) return hitEntry.value;
  return pdOnce(`day:${day}`, async () => {
    const again = pdDayCache.get(day);
    if (again && Date.now() - again.at < ttlFor(again.value)) return again.value;
    const rows = await pdQ(PD_DAY_SQL, [`${day} 00:00:00`, `${pdAddDays(day, 1)} 00:00:00`]);
    const out = new Map();
    for (const r of rows) {
      if (!r.dcs_code) continue;
      out.set(r.dcs_code, {
        qty: Number(r.qty) || 0, autoQty: Number(r.auto_qty) || 0,
        entries: Number(r.entries) || 0, autoW: Number(r.auto_w_cnt) || 0,
        manW: Number(r.man_w_cnt) || 0, autoF: Number(r.auto_f_cnt) || 0,
        manF: Number(r.man_f_cnt) || 0,
      });
    }
    pdCacheSet(pdDayCache, day, out);
    if (pdDayCache.size > PD_MAX_DAYS) {
      const oldest = [...pdDayCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
      for (const [k] of oldest) pdDayCache.delete(k);
    }
    return out;
  });
}

async function pdFetchRange(fromDate, toDate) {
  const days = pdDayList(fromDate, toDate);
  const todo = days.filter(d => !pdDayCache.has(d));
  for (let i = 0; i < todo.length; i += PD_POOL_SIZE) {
    await Promise.all(todo.slice(i, i + PD_POOL_SIZE).map(pdFetchDay));
  }
  const out = [];
  for (const d of days) out.push([d, await pdFetchDay(d)]);
  return out;
}

// ── aggregation ──────────────────────────────────────────────────────────────
const pdPct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
function pdAccumulate(perDay, dmap) {
  const totals = new Map();
  for (const [, rows] of perDay) {
    for (const [dcs, v] of rows) {
      const taluk = dmap.get(dcs);
      if (!taluk) continue;
      if (!totals.has(taluk)) totals.set(taluk, new Map());
      const bucket = totals.get(taluk);
      const acc = bucket.get(dcs);
      if (!acc) bucket.set(dcs, { ...v });
      else {
        acc.qty += v.qty; acc.autoQty += v.autoQty; acc.entries += v.entries;
        acc.autoW += v.autoW; acc.manW += v.manW; acc.autoF += v.autoF; acc.manF += v.manF;
      }
    }
  }
  return totals;
}
function pdSocietyFlags(rows) {
  let fow = 0, fmw = 0, fof = 0, fmf = 0;
  for (const v of rows.values()) {
    if (v.entries <= 0) continue;
    if (v.manW === 0) fow++;
    if (v.autoW === 0) fmw++;
    if (v.manF === 0) fof++;
    if (v.autoF === 0) fmf++;
  }
  return { fow, fmw, fof, fmf };
}
function pdSumField(rows, f) { let s = 0; for (const v of rows.values()) s += v[f]; return s; }

// ── distribution buckets ─────────────────────────────────────────────────────
const PD_BUCKET_ORDER = ['100%', '91-99%', '81-90%', '71-80%', '61-70%', '51-60%',
                         '41-50%', '31-40%', '21-30%', '11-20%', '1-10%', '0%'];
function pdBucketOf(p) {
  if (p >= 100) return '100%';
  if (p <= 0) return '0%';
  if (p >= 91) return '91-99%';
  if (p >= 81) return '81-90%';
  if (p >= 71) return '71-80%';
  if (p >= 61) return '61-70%';
  if (p >= 51) return '51-60%';
  if (p >= 41) return '41-50%';
  if (p >= 31) return '31-40%';
  if (p >= 21) return '21-30%';
  if (p >= 11) return '11-20%';
  return '1-10%';
}
function pdBucketsFor(perDay, dmap) {
  const totals = pdAccumulate(perDay, dmap);
  const all = new Map();
  for (const rows of totals.values()) for (const [k, v] of rows) all.set(k, v);
  const wb = {}, fb = {};
  for (const b of PD_BUCKET_ORDER) { wb[b] = 0; fb[b] = 0; }
  for (const v of all.values()) {
    if (v.entries <= 0) continue;
    wb[pdBucketOf(v.qty ? (v.autoQty / v.qty) * 100 : 0)]++;
    fb[pdBucketOf((v.autoF / v.entries) * 100)]++;
  }
  return { wb, fb };
}
const PD_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pdSpanLabel(d0, d1) {
  const a = pdParseDay(d0), b = pdParseDay(d1);
  const am = a.getUTCMonth(), bm = b.getUTCMonth();
  if (d0 === d1) return `${a.getUTCDate()} ${PD_MON[am]}`;
  if (am === bm && a.getUTCFullYear() === b.getUTCFullYear())
    return `${a.getUTCDate()}\u2013${b.getUTCDate()} ${PD_MON[am]}`;
  return `${a.getUTCDate()} ${PD_MON[am]} \u2013 ${b.getUTCDate()} ${PD_MON[bm]}`;
}
// Full Monday–Sunday week that CONTAINS date `d` (UTC Date). Weeks are NOT
// clipped to the month — a week keeps its real 7-day span even when it crosses
// a month boundary (e.g. 31 Aug – 6 Sep).
function pdWeekOf(d) {
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();   // Mon=1..Sun=7
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow + 1);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { from: pdIso(mon), to: pdIso(sun) };
}
function pdPrevWeek(week) { return pdWeekOf(pdParseDay(pdAddDays(week.from, -1))); }

// Build the 3 comparison windows for a basis: [oldest, middle, current].
// Each entry is [label, fromISO, toISO].
//   yesterday → 3 single days ending at `toDate`
//   weekly    → this month-clipped week + the previous 2
//   monthly   → this month (clipped to `toDate` if partial) + the previous 2
//   custom    → the N-day span + the previous N days + the N days before that
function pdComparePeriods(fromDate, toDate, basis) {
  // Check the explicit basis FIRST. A partial current week/month can be a
  // single day (e.g. Tuesday → current week is just Monday), and we must still
  // compare against whole prior weeks/months — not fall back to single days.
  if (basis === 'weekly') {
    // Every full Mon–Sun week from the FIRST week of the current month (the
    // Monday of the week containing the 1st — may fall in the previous month,
    // e.g. 31 Aug for a Sep whose 1st is a Tuesday) up to the week that
    // contains `toDate` (the last data day). The final week is clipped to
    // `toDate` so it shows only the days collected so far. Count is dynamic.
    const t = pdParseDay(toDate);
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    let wkStart = pdParseDay(pdWeekOf(first).from);
    const out = [];
    while (pdIso(wkStart) <= toDate) {
      const wkEnd = new Date(wkStart); wkEnd.setUTCDate(wkStart.getUTCDate() + 6);
      const endIso = pdIso(wkEnd) > toDate ? toDate : pdIso(wkEnd);  // clip current partial week
      const fromIso = pdIso(wkStart);
      out.push([pdSpanLabel(fromIso, endIso), fromIso, endIso]);
      wkStart = new Date(wkStart); wkStart.setUTCDate(wkStart.getUTCDate() + 7);
    }
    return out;
  }
  if (basis === 'monthly') {
    const f = pdParseDay(fromDate), out = [];
    for (let k = 2; k >= 0; k--) {
      const anchor = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - k, 1));
      const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
      const pFrom = pdIso(anchor);
      const pTo = k === 0 ? toDate : pdIso(last);   // current month clips to toDate
      const label = (k === 0 && toDate !== pdIso(last))
        ? pdSpanLabel(pFrom, pTo)
        : `${PD_MON[anchor.getUTCMonth()]} ${String(anchor.getUTCFullYear()).slice(2)}`;
      out.push([label, pFrom, pTo]);
    }
    return out;
  }
  if (basis === 'yesterday' || fromDate === toDate) {
    const out = [];
    for (let k = 2; k >= 0; k--) { const d = pdAddDays(toDate, -k); out.push([pdSpanLabel(d, d), d, d]); }
    return out;
  }
  // custom (default): N-day span vs previous N vs the N before that
  const N = Math.round((pdParseDay(toDate) - pdParseDay(fromDate)) / 86400000) + 1;
  const p1From = pdAddDays(fromDate, -N),     p1To = pdAddDays(fromDate, -1);
  const p2From = pdAddDays(fromDate, -2 * N), p2To = pdAddDays(fromDate, -N - 1);
  return [
    [pdSpanLabel(p2From, p2To), p2From, p2To],
    [pdSpanLabel(p1From, p1To), p1From, p1To],
    [pdSpanLabel(fromDate, toDate), fromDate, toDate],
  ];
}

// Per-period aggregate for the two time-series charts (Auto/Manual quantity and
// fully-online/manual society counts). Reuses the same day cache + accumulate
// path as the buckets, so no extra query types are issued.
function pdPeriodTotals(perDay, dmap) {
  const totals = pdAccumulate(perDay, dmap);
  const all = new Map();
  for (const rows of totals.values()) for (const [k, v] of rows) all.set(k, v);
  const autoQty = pdSumField(all, 'autoQty');
  const qty = pdSumField(all, 'qty');
  const { fow, fmw } = pdSocietyFlags(all);
  return {
    auto_qty: Math.round(autoQty),
    manual_qty: Math.round(qty - autoQty),
    fully_online_weight: fow,
    fully_manual_weight: fmw,
  };
}

// ── endpoint builders ────────────────────────────────────────────────────────
async function pdDigitalAll(fromDate, toDate) {
  let withoutAmcu = pdCacheGet(pdCache, 'without_amcu', 60 * 60 * 1000);
  if (withoutAmcu === undefined) {
    const rows = await pdQ(
      `SELECT COUNT(*) AS cnt FROM tbl_dcs d
       WHERE d.is_active=1 AND d.is_delete=0
         AND NOT EXISTS (SELECT 1 FROM tbl_identity_collection_point i
                         WHERE i.dcs_code=d.dcs_code AND i.is_active=1 AND i.is_delete=0)`);
    withoutAmcu = Number(rows[0]?.cnt) || 0;
    pdCacheSet(pdCache, 'without_amcu', withoutAmcu);
  }
  const dmap = await pdDcsTalukMap();
  const perDay = await pdFetchRange(fromDate, toDate);
  const totals = pdAccumulate(perDay, dmap);

  const taluks = Object.keys(PD_TALUKS).sort().map(name => {
    const rows = totals.get(name) || new Map();
    const qty = pdSumField(rows, 'qty'), autoQty = pdSumField(rows, 'autoQty'), entries = pdSumField(rows, 'entries');
    const { fow, fmw, fof, fmf } = pdSocietyFlags(rows);
    return {
      taluk: name, auto_weight_pct: pdPct(autoQty, qty), auto_fat_pct: pdPct(pdSumField(rows, 'autoF'), entries),
      total_dcs: rows.size, manual_weight_entries: pdSumField(rows, 'manW'), total_entries: entries,
      fully_online_weight: fow, fully_manual_weight: fmw, fully_online_fat: fof, fully_manual_fat: fmf,
    };
  });

  const all = new Map();
  for (const rows of totals.values()) for (const [k, v] of rows) all.set(k, v);
  const uQty = pdSumField(all, 'qty'), uEntries = pdSumField(all, 'entries');
  const union = {
    auto_weight_pct: pdPct(pdSumField(all, 'autoQty'), uQty),
    auto_fat_pct: pdPct(pdSumField(all, 'autoF'), uEntries),
    total_dcs: all.size, manual_weight_entries: pdSumField(all, 'manW'), total_entries: uEntries,
    fully_online_weight: taluks.reduce((s, t) => s + t.fully_online_weight, 0),
    fully_manual_weight: taluks.reduce((s, t) => s + t.fully_manual_weight, 0),
    fully_online_fat: taluks.reduce((s, t) => s + t.fully_online_fat, 0),
    fully_manual_fat: taluks.reduce((s, t) => s + t.fully_manual_fat, 0),
    without_amcu: withoutAmcu, from_date: fromDate, to_date: toDate,
  };
  return { union, taluks };
}

async function pdDigitalSeries(fromDate, toDate, basis) {
  const dmap = await pdDcsTalukMap();
  const perDay = await pdFetchRange(fromDate, toDate);
  const dates = [], autoWPct = [], autoFPct = [], totalQty = [], autoQty = [], fullOnW = [], fullManW = [];
  for (const [day, rowsAll] of perDay) {
    const rows = new Map();
    for (const [k, v] of rowsAll) if (dmap.has(k)) rows.set(k, v);
    const qty = pdSumField(rows, 'qty'), ent = pdSumField(rows, 'entries'), aq = pdSumField(rows, 'autoQty');
    const { fow, fmw } = pdSocietyFlags(rows);
    dates.push(day); autoWPct.push(pdPct(aq, qty)); autoFPct.push(pdPct(pdSumField(rows, 'autoF'), ent));
    totalQty.push(Math.round(qty)); autoQty.push(Math.round(aq)); fullOnW.push(fow); fullManW.push(fmw);
  }
  // Three comparison windows (this period vs prev vs 2-prior). Each snapshot
  // carries BOTH the distribution buckets (charts 3 & 4) and the per-period
  // aggregates the time-series charts (1 & 2) render.
  const snapshots = [];
  for (const [label, pFrom, pTo] of pdComparePeriods(fromDate, toDate, basis)) {
    const pDays = await pdFetchRange(pFrom, pTo);
    const { wb, fb } = pdBucketsFor(pDays, dmap);
    const tot = pdPeriodTotals(pDays, dmap);
    snapshots.push({ label, from_date: pFrom, to_date: pTo,
      weight_buckets: PD_BUCKET_ORDER.map(b => wb[b]), fat_buckets: PD_BUCKET_ORDER.map(b => fb[b]),
      auto_qty: tot.auto_qty, manual_qty: tot.manual_qty,
      fully_online_weight: tot.fully_online_weight, fully_manual_weight: tot.fully_manual_weight });
  }
  const { wb, fb } = pdBucketsFor(perDay, dmap);
  return {
    bucket_snapshots: snapshots, bucket_periods: snapshots.map(s => s.label),
    dates, auto_weight_pct: autoWPct, auto_fat_pct: autoFPct, total_qty: totalQty, auto_qty: autoQty,
    fully_online_weight: fullOnW, fully_manual_weight: fullManW,
    bucket_labels: PD_BUCKET_ORDER, weight_buckets: PD_BUCKET_ORDER.map(b => wb[b]), fat_buckets: PD_BUCKET_ORDER.map(b => fb[b]),
  };
}

const pdBillTtl = toDate => (toDate < pdTodayISO() ? PD_CLOSED_TTL : PD_CACHE_TTL);

// True when a cached farmers result carries no real rows — an aggregate whose
// pourings/qty are all zero/null, or an empty top-10 list. Used so a completed
// day cached while its data hadn't landed yet isn't frozen for 24h.
function pdEmptyResult(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const n = Number(v.pourings_recorded);
    if (!Number.isNaN(n)) return n === 0;               // pourings aggregate
    if ('farmer_app_users' in v) return false;          // app counts: 0 is valid
  }
  return false;
}

async function pdFarmersAll(fromDate, toDate) {
  const toExcl = pdAddDays(toDate, 1);
  // Value-aware TTL: a past day with real data is held 24h, but an EMPTY
  // completed day re-checks every PD_CACHE_TTL so it self-heals once the bills
  // arrive — same guard as the digital day cache.
  const cached = async (key, longTtl, fn) => {
    const entry = pdCache.get(key);
    if (entry) {
      const ttl = pdEmptyResult(entry.value) ? PD_CACHE_TTL : longTtl;
      if (Date.now() - entry.at < ttl) return entry.value;
    }
    return pdOnce(key, async () => { const v = await fn(); pdCacheSet(pdCache, key, v); return v; });
  };
  const ttl = pdBillTtl(toDate);
  const [app, pour, topQty, topFat] = await Promise.all([
    cached(`app_${toDate}`, PD_CACHE_TTL, async () => (await pdQ(
      `SELECT SUM(CASE WHEN type=1 THEN 1 ELSE 0 END) AS farmer_app_users,
              SUM(CASE WHEN type=3 THEN 1 ELSE 0 END) AS secretary_app_users
       FROM tbl_app_activation
       WHERE is_active=1 AND is_delete=0 AND orignating_timestamp < ?`, [toExcl]))[0] || {}),
    cached(`pour_${fromDate}_${toDate}`, ttl, async () => (await pdQ(
      `SELECT COUNT(*) AS pourings_recorded, ROUND(SUM(milk_qty),0) AS total_qty_ltrs, ROUND(AVG(avg_fat),2) AS avg_fat
       FROM tbl_farmer_bill WHERE created_at >= ? AND created_at < ? AND milk_qty > 0`, [fromDate, toExcl]))[0] || {}),
    // Top quantity pourers from actual collections (tbl_milk_collection by
    // collection_date). Aggregate first, then join names to only the top 10.
    cached(`topqty_${fromDate}_${toDate}`, ttl, () => pdQ(
      `SELECT m.member_name, d.dcs_name, s.sub_district_name AS taluk, t.total_qty, t.pours, t.avg_fat
       FROM (SELECT member_code, dcs_code,
                    ROUND(SUM(quantity),1)      AS total_qty,
                    COUNT(*)                    AS pours,
                    ROUND(AVG(NULLIF(fat,0)),2) AS avg_fat
             FROM tbl_milk_collection
             WHERE collection_date >= ? AND collection_date < ? AND is_delete = 0
             GROUP BY member_code, dcs_code
             ORDER BY total_qty DESC
             LIMIT 10) t
       LEFT JOIN tbl_member m        ON m.member_code = t.member_code AND m.is_delete = 0
       LEFT JOIN tbl_dcs d           ON d.dcs_code = t.dcs_code
       LEFT JOIN tbl_sub_districts s ON s.sub_district_code = d.sub_district_code
       ORDER BY t.total_qty DESC`, [fromDate, toExcl])),
    cached(`topfat_${fromDate}_${toDate}`, ttl, () => pdQ(
      `SELECT m.member_name, d.dcs_name, s.sub_district_name AS taluk, t.avg_fat, t.total_qty
       FROM (SELECT member_code, dcs_code, ROUND(AVG(avg_fat),2) AS avg_fat, ROUND(SUM(milk_qty),1) AS total_qty
             FROM tbl_farmer_bill WHERE created_at >= ? AND created_at < ? AND milk_qty > 50
             GROUP BY member_code, dcs_code ORDER BY avg_fat DESC LIMIT 40) t
       JOIN tbl_member m ON m.member_code=t.member_code AND m.is_delete=0
       JOIN tbl_dcs d ON d.dcs_code=t.dcs_code
       JOIN tbl_sub_districts s ON s.sub_district_code=d.sub_district_code
       ORDER BY t.avg_fat DESC LIMIT 10`, [fromDate, toExcl])),
  ]);
  const num = v => Number(v) || 0;
  return {
    kpis: {
      as_of: toDate, from_date: fromDate, to_date: toDate,
      farmer_app_users: num(app.farmer_app_users), secretary_app_users: num(app.secretary_app_users),
      pourings_recorded: num(pour.pourings_recorded), total_qty_ltrs: num(pour.total_qty_ltrs), avg_fat: num(pour.avg_fat),
    },
    top_quantity_pourers: topQty || [], top_fat_pourers: topFat || [],
  };
}

// ── PreDairy routes ──────────────────────────────────────────────────────────
const pdRange = req => {
  const t = pdTodayISO();
  return {
    from: String(req.query.from_date || t).slice(0, 10),
    to: String(req.query.to_date || t).slice(0, 10),
    basis: String(req.query.basis || '').toLowerCase(),   // yesterday|weekly|monthly|custom
  };
};
const pdFail = (res, e) => { console.error('[predairy]', e && e.message ? e.message : e); res.status(500).json({ error: String((e && e.message) || e) }); };

app.get('/api/digital/all', async (req, res) => {
  const { from, to } = pdRange(req);
  try { res.json(await pdDigitalAll(from, to)); } catch (e) { pdFail(res, e); }
});
app.get('/api/digital/series', async (req, res) => {
  const { from, to, basis } = pdRange(req);
  try { res.json(await pdDigitalSeries(from, to, basis)); } catch (e) { pdFail(res, e); }
});
app.get('/api/digital/bundle', async (req, res) => {
  const { from, to, basis } = pdRange(req);
  try {
    const base = await pdDigitalAll(from, to);
    base.series = await pdDigitalSeries(from, to, basis);
    res.json(base);
  } catch (e) { pdFail(res, e); }
});
app.get('/api/farmers/all', async (req, res) => {
  const { from, to } = pdRange(req);
  try { res.json(await pdFarmersAll(from, to)); } catch (e) { pdFail(res, e); }
});
app.get('/api/farmers/kpis', async (req, res) => {
  const { from, to } = pdRange(req);
  try { res.json((await pdFarmersAll(from, to)).kpis); } catch (e) { pdFail(res, e); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bangalore Dairy API running on port ${PORT}`);
  // warm procurement cache on startup
  setTimeout(() => {
    const http = require('http');
    http.get(`http://127.0.0.1:${PORT}/api/bangalore/union054/procurement`, r => {
      r.resume();
      console.log('Procurement cache warmed, status:', r.statusCode);
    }).on('error', e => console.log('Cache warm error:', e.message));
  }, 2000);
});
