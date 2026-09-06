'=============================================================================
' SAP DAILY TRACKER UPDATER v5.0 - LibreOffice-safe runtime
' -----------------------------------------------------------------------------
' Smart redesign for LibreOffice Calc users:
'   - VBS no longer reads/writes XLSX through ACE OLEDB.
'   - Python exports SAP_Daily_Input_WORKLIST.csv before this script runs.
'   - This script reads the worklist CSV, updates SAP, and writes STATUS.csv.
'   - Python then merges STATUS.csv back into XLSX with openpyxl.
'
' Important SAP behavior:
'   - No fixed 2nd-row update.
'   - Finds SAP row by PO + Material + Line + Scheduled Date + Qty.
'   - If duplicate SAP rows have the same key, each Excel row uses the next unused match.
'=============================================================================

Option Explicit

'===============================================================================
' CONFIG
'===============================================================================
' BASE folder is auto-detected from this VBS file location.
' Keep the VBS, BAT, Python, and XLSX in the same folder.
Const LOG_SUFFIX        = "_STATUS.csv"
Const CHKPT_SUFFIX      = "_CHECKPOINT.txt"
Const SLEEP_SHORT       = 180
Const SLEEP_LONG        = 350
Const HEARTBEAT_N       = 30
Const CHECKPOINT_N      = 25
Const MAX_RETRY         = 3
Const CONSEC_ERR_MAX    = 3
Const CONSEC_ERR_WAIT   = 10000

' SAP grid / popup column IDs
Const SAP_OPEN_COL      = "REM"
Const SAP_COL_PO        = "EBELN"
Const SAP_COL_MAT       = "MATNR"
Const SAP_COL_LINE      = "EBELP"
Const SAP_COL_SCHEDDT   = "EINDT"
Const SAP_COL_QTY       = "PEN_SCH_QTY_DIS"
Const SAP_COL_QTY_ALT1  = "WMENG"
Const SAP_COL_QTY_ALT2  = "MENGE"
Const SAP_COL_STATUS    = "STATUS"
Const SAP_COL_VENDOR    = "LIFNR"
Const SAP_COL_VENDORNM  = "NAME1"
Const SAP_COL_PODATE    = "BEDAT"
Const SAP_COL_MATDESC   = "MAKTX"

' STATUS CONSTANTS
Const ST_DONE           = "Updated Successfully"
Const ST_VAL_ERR        = "Validation Error"
Const ST_SAP_ERR        = "SAP Error"
Const ST_SKIPPED        = "Skipped"
Const VALID_CUMMODES    = "|EMAIL|PHONE|VISIT|SANYOG|"

' GLOBALS
Dim g_sapSess, g_oGrid, g_sapTotalRows
Dim g_Done, g_Skipped, g_ValErr, g_SapErr, g_Total, g_Pending
Dim g_fso, g_logFile, g_chkptFile, g_chkptPath, g_consecErrors
Dim g_matchFile, g_matchPath
Dim g_BaseDir, g_XlsxPath, g_WorklistCsv, g_SapSnapshotPath, g_ColumnDiscoveryPath
Dim g_usedSapRows, g_DryRun, g_ExportOnly, g_DiscoverOnly, g_RunID

On Error Resume Next
Main
If Err.Number <> 0 Then
    WScript.Echo "[FATAL] Unhandled error: " & Err.Description
    WScript.Echo "        Source: " & Err.Source
    WScript.Echo "        Error #: " & Err.Number
End If
On Error GoTo 0

Sub Main()
    Set g_fso = CreateObject("Scripting.FileSystemObject")
    InitConfig
    InitArgs

    g_Done = 0 : g_Skipped = 0 : g_ValErr = 0 : g_SapErr = 0
    g_Total = 0 : g_Pending = 0 : g_consecErrors = 0
    Set g_usedSapRows = CreateObject("Scripting.Dictionary")

    If (Not g_ExportOnly) And (Not g_fso.FileExists(g_WorklistCsv)) Then
        WScript.Echo "[FATAL] Worklist CSV not found: " & g_WorklistCsv
        WScript.Echo "        Run Python validate-export first."
        WScript.Quit 1
    End If

    ConnectSAP
    GetSAPGrid

    If g_DiscoverOnly Then
        DiscoverSapColumns
        WScript.Echo "[OK] SAP column discovery complete."
        Exit Sub
    End If

    If g_ExportOnly Then
        ExportSapSnapshot
        WScript.Echo "[OK] SAP snapshot export complete."
        Exit Sub
    End If

    WScript.Echo "[MAP]  Key-match mode: PO + Material + Line + SchedDate + Qty. Duplicate keys use next unused SAP row."

    OpenStatusAndCheckpointFiles

    Dim rows : rows = ReadCsvFile(g_WorklistCsv)
    If IsEmpty(rows) Then
        WScript.Echo "[INFO] Worklist is empty. Nothing to update."
    Else
        Dim i
        For i = 1 To UBound(rows)   ' row 0 is CSV header
            If Trim(Join(rows(i), "")) <> "" Then
                g_Total = g_Total + 1
                ProcessWorkItem rows(0), rows(i), g_Total
            End If
        Next
    End If

    g_Pending = g_Total - g_Done - g_Skipped - g_ValErr - g_SapErr

    g_logFile.WriteLine ""
    g_logFile.WriteLine "=== SUMMARY ==="
    g_logFile.WriteLine "Total Records," & g_Total
    g_logFile.WriteLine "Updated Successfully," & g_Done
    g_logFile.WriteLine "SAP Errors," & g_SapErr
    g_logFile.WriteLine "Validation Errors," & g_ValErr
    g_logFile.WriteLine "Skipped," & g_Skipped
    g_logFile.WriteLine "Still Pending," & g_Pending
    g_logFile.WriteLine "Completed," & FormatTS(Now())
    g_logFile.Close
    If IsObject(g_matchFile) Then g_matchFile.Close

    g_chkptFile.WriteLine "Completed: " & FormatTS(Now())
    g_chkptFile.WriteLine "Status: DONE"
    g_chkptFile.Close

    WScript.Echo ""
    WScript.Echo "===================================================="
    WScript.Echo " SAP UPDATER v5.0 LO - COMPLETE"
    WScript.Echo "===================================================="
    WScript.Echo " Total Records          : " & g_Total
    WScript.Echo " Updated Successfully   : " & g_Done
    WScript.Echo " SAP Errors             : " & g_SapErr
    WScript.Echo " Validation Errors      : " & g_ValErr
    WScript.Echo " Skipped                : " & g_Skipped
    WScript.Echo " Still Pending          : " & g_Pending
    WScript.Echo "----------------------------------------------------"
    WScript.Echo " Status CSV : " & StatusCsvPath()
    WScript.Echo " Match CSV  : " & g_matchPath
    WScript.Echo " Checkpoint : " & g_chkptPath
    WScript.Echo "===================================================="
End Sub

Sub InitConfig()
    g_BaseDir = g_fso.GetParentFolderName(WScript.ScriptFullName)
    g_XlsxPath = g_BaseDir & "\SAP_Daily_Input.xlsx"
    g_WorklistCsv = g_BaseDir & "\SAP_Daily_Input_WORKLIST.csv"
    g_SapSnapshotPath = g_BaseDir & "\SAP_Daily_Input_SAP_SNAPSHOT.csv"
    g_ColumnDiscoveryPath = g_BaseDir & "\SAP_Daily_Input_SAP_COLUMN_DISCOVERY.csv"
    WScript.Echo "[CFG]  Base folder : " & g_BaseDir
    WScript.Echo "[CFG]  Worklist    : " & g_WorklistCsv
End Sub

Sub InitArgs()
    g_DryRun = False
    g_ExportOnly = False
    g_DiscoverOnly = False
    g_RunID = ""
    Dim i, arg
    For i = 0 To WScript.Arguments.Count - 1
        arg = Trim(WScript.Arguments(i))
        If LCase(arg) = "--dry-run" Or LCase(arg) = "/dry-run" Then g_DryRun = True
        If LCase(arg) = "--export-sap" Or LCase(arg) = "/export-sap" Then g_ExportOnly = True
        If LCase(arg) = "--discover-columns" Or LCase(arg) = "/discover-columns" Then g_DiscoverOnly = True
        If Len(arg) >= 9 Then
            If LCase(Left(arg, 9)) = "--run-id=" Then g_RunID = Mid(arg, 10)
        End If
    Next
    If g_DryRun Then WScript.Echo "[MODE] DRY RUN - SAP rows will be matched, but popup/save will NOT be executed."
    If g_ExportOnly Then WScript.Echo "[MODE] SAP SNAPSHOT EXPORT ONLY."
    If g_DiscoverOnly Then WScript.Echo "[MODE] SAP COLUMN DISCOVERY ONLY."
End Sub

Sub ConnectSAP()
    Dim sapGuiAuto, sapApp, sapConn
    On Error Resume Next
    Set sapGuiAuto = GetObject("SAPGUI")
    If Err.Number <> 0 Then
        WScript.Echo "[FATAL] SAP GUI not running. Open SAP and go to ZSCH_UPDATE first."
        WScript.Quit 1
    End If
    Err.Clear : On Error GoTo 0

    Set sapApp = sapGuiAuto.GetScriptingEngine
    Set sapConn = sapApp.Children(0)
    Set g_sapSess = sapConn.Children(0)

    If IsObject(WScript) Then
        WScript.ConnectObject g_sapSess, "on"
        WScript.ConnectObject sapApp, "on"
    End If

    g_sapSess.findById("wnd[0]").maximize
    WScript.Echo "[SAP]  Connected. Session: " & g_sapSess.ID

    Dim activeScreen : activeScreen = ""
    On Error Resume Next
    activeScreen = g_sapSess.findById("wnd[0]/titl").Text
    Err.Clear : On Error GoTo 0
    WScript.Echo "[SAP]  Active screen: " & activeScreen
End Sub

Sub GetSAPGrid()
    On Error Resume Next
    Set g_oGrid = g_sapSess.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
    If Err.Number <> 0 Or Not IsObject(g_oGrid) Then
        WScript.Echo "[FATAL] Cannot find SAP grid. Make sure ZSCH_UPDATE results are loaded."
        WScript.Quit 1
    End If
    Err.Clear : On Error GoTo 0

    g_sapTotalRows = g_oGrid.RowCount
    WScript.Echo "[SAP]  Grid rows: " & g_sapTotalRows

    If g_sapTotalRows <= 0 Then
        WScript.Echo "[FATAL] SAP grid has no rows."
        WScript.Quit 1
    End If

    ' No fixed-row selection here. Row selection is done by exact key matching during processing.
    If Not g_DiscoverOnly Then ValidateSapColumns
End Sub

Sub ValidateSapColumns()
    Dim missing : missing = ""
    If Not CanReadSapColumn(SAP_COL_PO) Then missing = AppendMsg(missing, SAP_COL_PO)
    If Not CanReadSapColumn(SAP_COL_MAT) Then missing = AppendMsg(missing, SAP_COL_MAT)
    If Not CanReadSapColumn(SAP_COL_LINE) Then missing = AppendMsg(missing, SAP_COL_LINE)
    If Not CanReadSapColumn(SAP_COL_SCHEDDT) Then missing = AppendMsg(missing, SAP_COL_SCHEDDT)
    If GridQtyCell(0) = "" Then missing = AppendMsg(missing, SAP_COL_QTY & "/" & SAP_COL_QTY_ALT1 & "/" & SAP_COL_QTY_ALT2)
    If Not CanSelectSapColumn(SAP_OPEN_COL) Then missing = AppendMsg(missing, SAP_OPEN_COL)

    If missing <> "" Then
        WScript.Echo "[FATAL] SAP grid required column(s) missing/unreadable: " & missing
        WScript.Echo "        Check SAP layout variant and technical column IDs in VBS/config."
        WScript.Quit 1
    End If
    WScript.Echo "[SAP]  Required grid columns validated OK."
End Sub

Function CanReadSapColumn(colId)
    CanReadSapColumn = False
    On Error Resume Next
    Dim v : v = g_oGrid.GetCellValue(0, colId)
    If Err.Number = 0 Then CanReadSapColumn = True
    Err.Clear : On Error GoTo 0
End Function

Function CanSelectSapColumn(colId)
    CanSelectSapColumn = False
    On Error Resume Next
    g_oGrid.CurrentCellRow = 0
    g_oGrid.CurrentCellColumn = colId
    If Err.Number = 0 Then CanSelectSapColumn = True
    Err.Clear : On Error GoTo 0
End Function

Sub DiscoverSapColumns()
    Dim f : Set f = g_fso.CreateTextFile(g_ColumnDiscoveryPath, True, False)
    f.WriteLine "RunID,ColumnID,Role,Readable,SampleRow0,SampleRow1,SampleRow2,Notes"
    WriteColumnDiscovery f, SAP_COL_PO, "PO Number"
    WriteColumnDiscovery f, SAP_COL_MAT, "Material Code"
    WriteColumnDiscovery f, SAP_COL_LINE, "PO Line"
    WriteColumnDiscovery f, SAP_COL_SCHEDDT, "Schedule Date"
    WriteColumnDiscovery f, SAP_COL_QTY, "Quantity Primary"
    WriteColumnDiscovery f, SAP_COL_QTY_ALT1, "Quantity Fallback 1"
    WriteColumnDiscovery f, SAP_COL_QTY_ALT2, "Quantity Fallback 2"
    WriteColumnDiscovery f, SAP_OPEN_COL, "Popup/Open REM"
    WriteColumnDiscovery f, SAP_COL_STATUS, "System Status Optional"
    WriteColumnDiscovery f, SAP_COL_VENDOR, "Vendor Code Optional"
    WriteColumnDiscovery f, SAP_COL_VENDORNM, "Vendor Name Optional"
    WriteColumnDiscovery f, SAP_COL_PODATE, "PO Date Optional"
    WriteColumnDiscovery f, SAP_COL_MATDESC, "Material Description Optional"
    f.Close
    WScript.Echo "[DISCOVERY] SAP column discovery: " & g_ColumnDiscoveryPath
End Sub

Sub WriteColumnDiscovery(f, colId, role)
    Dim readable : readable = "NO"
    Dim s0, s1, s2, notes
    s0 = "" : s1 = "" : s2 = "" : notes = ""
    On Error Resume Next
    s0 = GridCellRetry(0, colId)
    If g_sapTotalRows > 1 Then s1 = GridCellRetry(1, colId)
    If g_sapTotalRows > 2 Then s2 = GridCellRetry(2, colId)
    If Err.Number = 0 Then readable = "YES" Else notes = Err.Description
    Err.Clear : On Error GoTo 0
    f.WriteLine CsvLine(Array(g_RunID, colId, role, readable, s0, s1, s2, notes))
End Sub

Sub ExportSapSnapshot()
    Dim f : Set f = g_fso.CreateTextFile(g_SapSnapshotPath, True, False)
    f.WriteLine "RunID,SAPRow,SystemStatus,VendorCode,VendorName,PO,PODate,Line,MaterialCode,SchedDate,Qty,MaterialDesc"

    WScript.Echo "[EXPORT] Capturing SAP snapshot from first row to last row. Total SAP rows: " & g_sapTotalRows
    ScrollGridToTop

    Dim r, po, mat, line, sched, qty, captured, skipped, blankRows, badRows
    captured = 0 : skipped = 0 : blankRows = 0 : badRows = 0
    For r = 0 To CLng(g_sapTotalRows) - 1
        ' Critical for virtual/scrollable SAP grids: bring each row into view before reading.
        EnsureSapRowVisible r

        po = GridCellRetry(r, SAP_COL_PO)
        mat = GridCellRetry(r, SAP_COL_MAT)
        line = GridCellRetry(r, SAP_COL_LINE)
        sched = GridCellRetry(r, SAP_COL_SCHEDDT)
        qty = GridQtyCellRetry(r)

        If Trim(po) <> "" And Trim(mat) <> "" And Trim(line) <> "" And Trim(sched) <> "" And Trim(qty) <> "" Then
            f.WriteLine CsvLine(Array(g_RunID, CStr(r), _
                GridCellRetry(r, SAP_COL_STATUS), GridCellRetry(r, SAP_COL_VENDOR), GridCellRetry(r, SAP_COL_VENDORNM), _
                po, GridCellRetry(r, SAP_COL_PODATE), line, mat, sched, qty, GridCellRetry(r, SAP_COL_MATDESC)))
            captured = captured + 1
        Else
            skipped = skipped + 1
            If Trim(po) = "" And Trim(mat) = "" And Trim(line) = "" And Trim(sched) = "" And Trim(qty) = "" Then
                blankRows = blankRows + 1
                WScript.Echo "[EXPORT][INFO] Ignored fully blank SAP row " & r
            Else
                ' Do not stop the run for hidden/collapsed/unreadable SAP rows.
                ' They are excluded from snapshot and will not be processed.
                blankRows = blankRows + 1
                WScript.Echo "[EXPORT][WARN] Ignored incomplete/hidden SAP row " & r & ". PO=" & po & " MAT=" & mat & " LINE=" & line & " DATE=" & sched & " QTY=" & qty
            End If
        End If

        If (r + 1) Mod 50 = 0 Then WScript.Echo "[EXPORT] Captured progress: " & (r + 1) & " / " & g_sapTotalRows
    Next
    f.Close
    ScrollGridToTop
    WScript.Echo "[EXPORT] SAP snapshot: " & g_SapSnapshotPath
    WScript.Echo "[EXPORT] Snapshot rows captured=" & captured & " skipped=" & skipped & " ignored=" & blankRows & " bad=" & badRows & " SAP total=" & g_sapTotalRows
End Sub

Sub OpenStatusAndCheckpointFiles()
    Dim logPath : logPath = StatusCsvPath()
    Set g_logFile = g_fso.CreateTextFile(logPath, True, False)
    g_logFile.WriteLine "ExcelRow,PO,Line,SchedDate,Qty,PERNR,CUMMODE,Status,ErrorRemarks,Timestamp"
    WScript.Echo "[LOG]  " & logPath

    g_matchPath = g_BaseDir & "\" & g_fso.GetBaseName(g_XlsxPath) & "_MATCH_REPORT.csv"
    Set g_matchFile = g_fso.CreateTextFile(g_matchPath, True, False)
    g_matchFile.WriteLine "RunID,ExcelRow,VendorName,PO,MaterialCode,Line,SchedDate,Qty,MatchKey,KeyOccurrence,KeyTotal,SAPRow,MatchStatus,Message"
    WScript.Echo "[MATCH] " & g_matchPath

    g_chkptPath = g_BaseDir & "\" & g_fso.GetBaseName(g_XlsxPath) & CHKPT_SUFFIX
    Set g_chkptFile = g_fso.CreateTextFile(g_chkptPath, True, False)
    g_chkptFile.WriteLine "SAP Updater v5.0 LO - Checkpoint Log"
    g_chkptFile.WriteLine "Started: " & FormatTS(Now())
End Sub

Function StatusCsvPath()
    StatusCsvPath = g_BaseDir & "\" & g_fso.GetBaseName(g_XlsxPath) & LOG_SUFFIX
End Function

Sub ProcessWorkItem(header, row, dataIndex)
    Dim runID    : runID    = CsvValue(header, row, "RunID")
    Dim excelRow : excelRow = CsvValue(header, row, "ExcelRow")
    Dim vendorNm : vendorNm = CsvValue(header, row, "VendorName")
    Dim matchKey : matchKey = CsvValue(header, row, "MatchKey")
    Dim keyOccur : keyOccur = CsvValue(header, row, "KeyOccurrence")
    Dim keyTotal : keyTotal = CsvValue(header, row, "KeyTotal")
    Dim sapRowHint : sapRowHint = CsvValue(header, row, "SAPRow")
    Dim po       : po       = CsvValue(header, row, "PO")
    Dim exLine   : exLine   = CsvValue(header, row, "Line")
    Dim exMat    : exMat    = CsvValue(header, row, "MaterialCode")
    Dim exSched  : exSched  = CsvValue(header, row, "SchedDate")
    Dim exQty    : exQty    = CsvValue(header, row, "Qty")
    Dim exExpDate: exExpDate= CsvValue(header, row, "ExpDate")
    Dim exRemarks: exRemarks= CsvValue(header, row, "Remarks")
    Dim exDFT    : exDFT    = CsvValue(header, row, "DFT")
    Dim exPERNR  : exPERNR  = CsvValue(header, row, "PERNR")
    Dim exCUMMODE: exCUMMODE= UCase(Trim(CsvValue(header, row, "CUMMODE")))
    Dim statusIn : statusIn = CsvValue(header, row, "StatusIn")

    If dataIndex Mod HEARTBEAT_N = 0 Then Ping_SAP
    If dataIndex Mod CHECKPOINT_N = 0 Then WriteCheckpoint dataIndex

    If po = "" Or po = "0" Then
        WScript.Echo "[Excel Row " & excelRow & "] SKIP - blank PO."
        g_Skipped = g_Skipped + 1
        Exit Sub
    End If

    If exMat = "" Then
        Dim matErr : matErr = "Material Code is missing; cannot match exact SAP row"
        WScript.Echo "[Excel Row " & excelRow & "] VALIDATION ERROR - " & matErr
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_VAL_ERR, matErr
        g_ValErr = g_ValErr + 1
        Exit Sub
    End If

    If UCase(Trim(statusIn)) = UCase(ST_DONE) Then
        WScript.Echo "[Excel Row " & excelRow & "] SKIP - already done."
        g_Skipped = g_Skipped + 1
        Exit Sub
    End If

    Dim valErr : valErr = ValidateRow(exExpDate, exRemarks, exDFT, exPERNR, exCUMMODE)
    If valErr <> "" Then
        WScript.Echo "[Excel Row " & excelRow & "] VALIDATION ERROR - " & valErr
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_VAL_ERR, valErr
        g_ValErr = g_ValErr + 1
        Exit Sub
    End If

    If exRemarks <> "" And exDFT = "" Then
        exDFT = "5.Delivery to confirm"
        WScript.Echo "[Excel Row " & excelRow & "] Auto-DFT -> 5.Delivery to confirm"
    End If

    Dim dftKey : dftKey = ResolveDFTKey(exDFT)

    WScript.Echo "[Excel Row " & excelRow & "] PO=" & po & " Mat=" & exMat & " Line=" & exLine & _
                 " Sched=" & exSched & " Qty=" & exQty & _
                 " PERNR=" & exPERNR & " MODE=" & exCUMMODE & _
                 " EXP=" & exExpDate & " DFT=" & dftKey & _
                 " REM=" & Left(exRemarks, 35)

    ' Exact key-match mode. If SAP contains duplicate rows with the same
    ' PO+Material+Line+Date+Qty, each Excel row uses the next unused SAP row.
    Dim sapRow : sapRow = -1
    If IsNumeric(sapRowHint) Then
        sapRow = CLng(sapRowHint)
        If sapRow < 0 Or sapRow >= CLng(g_sapTotalRows) Or Not RowMatchesKey(sapRow, po, exMat, exLine, exSched, exQty) Or g_usedSapRows.Exists(CStr(sapRow)) Then
            WScript.Echo "[Excel Row " & excelRow & "] SAP row hint " & sapRowHint & " is no longer valid; falling back to full key search."
            sapRow = -1
        End If
    End If
    If sapRow < 0 Then sapRow = FindSapRow(po, exMat, exLine, exSched, exQty)
    If sapRow < 0 Then
        Dim notFoundMsg : notFoundMsg = "No unused SAP row found for PO=" & po & _
                         " Mat=" & exMat & " Line=" & exLine & " Sched=" & exSched & " Qty=" & exQty
        WScript.Echo "[Excel Row " & excelRow & "] SAP ERROR - " & notFoundMsg
        WriteMatch runID, excelRow, vendorNm, po, exMat, exLine, exSched, exQty, matchKey, keyOccur, keyTotal, "", "NOT_FOUND", notFoundMsg
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_SAP_ERR, notFoundMsg
        g_SapErr = g_SapErr + 1
        Exit Sub
    End If

    ' Reserve this SAP row immediately so duplicate Excel rows move to the next matching SAP row.
    g_usedSapRows(CStr(sapRow)) = True
    WScript.Echo "[Excel Row " & excelRow & "] -> SAP matched row " & sapRow
    WriteMatch runID, excelRow, vendorNm, po, exMat, exLine, exSched, exQty, matchKey, keyOccur, keyTotal, CStr(sapRow), "MATCHED", ""

    If g_DryRun Then
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, "Dry Run - Matched", "SAP row matched; no SAP update performed."
        g_Skipped = g_Skipped + 1
        Exit Sub
    End If

    Dim popOK : popOK = OpenPopup(sapRow)
    If Not popOK Then
        Dim popMsg : popMsg = "Failed to open popup for SAP row " & sapRow & " after " & MAX_RETRY & " attempts."
        WScript.Echo "[Excel Row " & excelRow & "] SAP ERROR - " & popMsg
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_SAP_ERR, popMsg
        g_SapErr = g_SapErr + 1
        BumpConsecError
        Exit Sub
    End If
    g_consecErrors = 0

    If Not FillPopup(excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, exExpDate, exRemarks, dftKey) Then
        Exit Sub
    End If

    WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_DONE, ""
    WScript.Echo "[Excel Row " & excelRow & "] DONE."
    g_Done = g_Done + 1
End Sub

Function FillPopup(excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, exExpDate, exRemarks, dftKey)
    FillPopup = False

    On Error Resume Next
    g_sapSess.findById("wnd[1]/usr/txtWA_ZPRS_DELIVER1100-PERNR").Text = exPERNR
    g_sapSess.findById("wnd[1]/usr/cmbWA_ZPRS_DELIVER1100-CUMMODE").Key = exCUMMODE
    g_sapSess.findById("wnd[1]/usr/cmbWA_ZPRS_DELIVER1100-CUMMODE").SetFocus
    WScript.Sleep 200
    If Err.Number <> 0 Then
        Dim fillErr : fillErr = "Fill PERNR/CUMMODE error: " & Err.Description
        Err.Clear : On Error GoTo 0
        CancelPopup
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_SAP_ERR, fillErr
        g_SapErr = g_SapErr + 1
        Exit Function
    End If
    On Error GoTo 0

    Dim remText : remText = exRemarks
    If remText = "" Then remText = "Waiting for dispatch date from supplier"

    On Error Resume Next
    g_sapSess.findById("wnd[1]/usr/btnREDIRECT_TO_TXT_FM").Press
    WScript.Sleep SLEEP_SHORT
    g_sapSess.findById("wnd[2]/usr/cntlTEXTEDITOR1/shellcont/shell").Text = remText
    g_sapSess.findById("wnd[2]/usr/cntlTEXTEDITOR1/shellcont/shell").SetSelectionIndexes Len(remText), Len(remText)
    WScript.Sleep 150
    g_sapSess.findById("wnd[2]/tbar[0]/btn[0]").Press
    WScript.Sleep SLEEP_SHORT
    If Err.Number <> 0 Then
        Dim remErr : remErr = "Remarks entry error: " & Err.Description
        Err.Clear : On Error GoTo 0
        CancelPopup
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_SAP_ERR, remErr
        g_SapErr = g_SapErr + 1
        Exit Function
    End If
    On Error GoTo 0

    If exExpDate <> "" Then
        On Error Resume Next
        g_sapSess.findById("wnd[1]/usr/ctxtWA_ZPRS_DELIVER1100-EXPDATE").Text = exExpDate
        If Err.Number <> 0 Then
            WScript.Echo "[Excel Row " & excelRow & "] WARN - Could not set ExpDate: " & Err.Description
            Err.Clear
        End If
        On Error GoTo 0
    End If

    If dftKey <> "" Then
        On Error Resume Next
        g_sapSess.findById("wnd[1]/usr/cmbWA_ZPRS_DELIVER1100-ZDFT_REASON").Key = dftKey
        If Err.Number <> 0 Then
            Dim dftErr : dftErr = "Invalid DFT key [" & dftKey & "]: " & Err.Description
            Err.Clear : On Error GoTo 0
            CancelPopup
            WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_SAP_ERR, dftErr
            g_SapErr = g_SapErr + 1
            Exit Function
        End If
        g_sapSess.findById("wnd[1]/usr/cmbWA_ZPRS_DELIVER1100-ZDFT_REASON").SetFocus
        On Error GoTo 0
    End If

    On Error Resume Next
    g_sapSess.findById("wnd[1]/usr/btn__SAVE_").Press
    WScript.Sleep SLEEP_SHORT
    If Err.Number <> 0 Then
        Dim saveErr : saveErr = "Save error: " & Err.Description
        Err.Clear : On Error GoTo 0
        WriteBack excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, ST_SAP_ERR, saveErr
        g_SapErr = g_SapErr + 1
        BumpConsecError
        Exit Function
    End If
    On Error GoTo 0

    DismissPostSavePopup
    g_consecErrors = 0
    FillPopup = True
End Function

Function RowMatchesKey(rowIdx, po, exMat, exLine, exSched, exQty)
    RowMatchesKey = False
    If rowIdx < 0 Or rowIdx >= CLng(g_sapTotalRows) Then Exit Function
    EnsureSapRowVisible rowIdx
    RowMatchesKey = (NormalizePO(GridCellRetry(rowIdx, SAP_COL_PO)) = NormalizePO(po) And _
                     NormalizeMaterial(GridCellRetry(rowIdx, SAP_COL_MAT)) = NormalizeMaterial(exMat) And _
                     NormalizeLine(GridCellRetry(rowIdx, SAP_COL_LINE)) = NormalizeLine(exLine) And _
                     NormalizeDateKey(GridCellRetry(rowIdx, SAP_COL_SCHEDDT)) = NormalizeDateKey(exSched) And _
                     NormalizeQty(GridQtyCellRetry(rowIdx)) = NormalizeQty(exQty))
End Function

Function FindSapRow(po, exMat, exLine, exSched, exQty)
    FindSapRow = -1

    Dim wantPO   : wantPO   = NormalizePO(po)
    Dim wantMat  : wantMat  = NormalizeMaterial(exMat)
    Dim wantLine : wantLine = NormalizeLine(exLine)
    Dim wantDate : wantDate = NormalizeDateKey(exSched)
    Dim wantQty  : wantQty  = NormalizeQty(exQty)

    Dim r, sapPO, sapMat, sapLine, sapDate, sapQty
    For r = 0 To CLng(g_sapTotalRows) - 1
        If Not g_usedSapRows.Exists(CStr(r)) Then
            EnsureSapRowVisible r
            sapPO   = NormalizePO(GridCellRetry(r, SAP_COL_PO))
            sapMat  = NormalizeMaterial(GridCellRetry(r, SAP_COL_MAT))
            sapLine = NormalizeLine(GridCellRetry(r, SAP_COL_LINE))
            sapDate = NormalizeDateKey(GridCellRetry(r, SAP_COL_SCHEDDT))
            sapQty  = NormalizeQty(GridQtyCellRetry(r))

            If sapPO = wantPO And sapMat = wantMat And sapLine = wantLine And _
               sapDate = wantDate And sapQty = wantQty Then
                FindSapRow = r
                Exit Function
            End If
        End If
    Next
End Function

Function GridCell(rowIdx, colId)
    GridCell = ""
    On Error Resume Next
    GridCell = Trim(CStr(g_oGrid.GetCellValue(rowIdx, colId)))
    If Err.Number <> 0 Then
        Err.Clear
        GridCell = ""
    End If
    On Error GoTo 0
End Function

Function GridQtyCell(rowIdx)
    GridQtyCell = GridCell(rowIdx, SAP_COL_QTY)
    If GridQtyCell <> "" Then Exit Function

    GridQtyCell = GridCell(rowIdx, SAP_COL_QTY_ALT1)
    If GridQtyCell <> "" Then Exit Function

    GridQtyCell = GridCell(rowIdx, SAP_COL_QTY_ALT2)
End Function

Function GridQtyCellRetry(rowIdx)
    GridQtyCellRetry = GridCellRetry(rowIdx, SAP_COL_QTY)
    If GridQtyCellRetry <> "" Then Exit Function

    GridQtyCellRetry = GridCellRetry(rowIdx, SAP_COL_QTY_ALT1)
    If GridQtyCellRetry <> "" Then Exit Function

    GridQtyCellRetry = GridCellRetry(rowIdx, SAP_COL_QTY_ALT2)
End Function

Function GridCellRetry(rowIdx, colId)
    Dim attempt, v
    GridCellRetry = ""
    For attempt = 1 To 3
        v = GridCell(rowIdx, colId)
        If Trim(v) <> "" Then
            GridCellRetry = v
            Exit Function
        End If
        EnsureSapRowVisible rowIdx
        WScript.Sleep 80 * attempt
    Next
    GridCellRetry = GridCell(rowIdx, colId)
End Function

Function GridVisibleRowCount()
    GridVisibleRowCount = 0
    On Error Resume Next
    GridVisibleRowCount = CLng(g_oGrid.VisibleRowCount)
    If Err.Number <> 0 Then
        Err.Clear
        GridVisibleRowCount = 0
    End If
    On Error GoTo 0
End Function

Sub ScrollGridToTop()
    On Error Resume Next
    g_oGrid.FirstVisibleRow = 0
    If Err.Number <> 0 Then Err.Clear
    g_oGrid.firstVisibleRow = 0
    If Err.Number <> 0 Then Err.Clear
    WScript.Sleep 200
    On Error GoTo 0
End Sub

Sub EnsureSapRowVisible(rowIdx)
    If rowIdx < 0 Then Exit Sub
    If rowIdx >= CLng(g_sapTotalRows) Then Exit Sub

    Dim vis, firstRow
    vis = GridVisibleRowCount()
    If vis <= 0 Then vis = 20

    ' Smart scroll guard: Skip scrolling if target row is already in active visible window
    Dim currentFirst : currentFirst = -1
    On Error Resume Next
    currentFirst = CLng(g_oGrid.FirstVisibleRow)
    If Err.Number <> 0 Then
        Err.Clear
        currentFirst = CLng(g_oGrid.firstVisibleRow)
        If Err.Number <> 0 Then Err.Clear
    End If
    On Error GoTo 0

    If currentFirst >= 0 Then
        If rowIdx >= currentFirst And rowIdx < (currentFirst + vis - 1) Then
            On Error Resume Next
            g_oGrid.CurrentCellRow = rowIdx
            If Err.Number <> 0 Then Err.Clear
            On Error GoTo 0
            Exit Sub
        End If
    End If

    ' Place target row near middle/top of visible block. This forces SAP virtual ALV to load that row.
    firstRow = rowIdx - 2
    If firstRow < 0 Then firstRow = 0

    On Error Resume Next
    g_oGrid.FirstVisibleRow = firstRow
    If Err.Number <> 0 Then Err.Clear
    g_oGrid.firstVisibleRow = firstRow
    If Err.Number <> 0 Then Err.Clear
    WScript.Sleep 80
    g_oGrid.CurrentCellRow = rowIdx
    If Err.Number <> 0 Then Err.Clear
    On Error GoTo 0
End Sub

Function DigitsOnly(s)
    Dim i, ch, out
    out = ""
    s = Trim(CStr(s))
    For i = 1 To Len(s)
        ch = Mid(s, i, 1)
        If ch >= "0" And ch <= "9" Then out = out & ch
    Next
    DigitsOnly = out
End Function

Function StripLeadingZeros(s)
    s = Trim(CStr(s))
    Do While Len(s) > 1 And Left(s, 1) = "0"
        s = Mid(s, 2)
    Loop
    StripLeadingZeros = s
End Function

Function NormalizePO(s)
    NormalizePO = StripLeadingZeros(DigitsOnly(s))
End Function

Function NormalizeLine(s)
    NormalizeLine = StripLeadingZeros(DigitsOnly(s))
End Function

Function NormalizeMaterial(s)
    s = UCase(Trim(CStr(s)))
    s = Replace(s, " ", "")
    If s = "" Then
        NormalizeMaterial = ""
    ElseIf IsNumeric(s) Then
        NormalizeMaterial = StripLeadingZeros(DigitsOnly(s))
    Else
        NormalizeMaterial = s
    End If
End Function

Function NormalizeDateKey(s)
    s = Trim(CStr(s))
    If s = "" Then
        NormalizeDateKey = ""
        Exit Function
    End If

    If InStr(s, " ") > 0 Then s = Left(s, InStr(s, " ") - 1)

    Dim p
    If InStr(s, ".") > 0 Then
        p = Split(s, ".")
        If UBound(p) >= 2 Then
            NormalizeDateKey = Right("0000" & p(2), 4) & Right("0" & p(1), 2) & Right("0" & p(0), 2)
            Exit Function
        End If
    End If

    If Len(s) >= 10 And Mid(s, 5, 1) = "-" Then
        NormalizeDateKey = Left(s, 4) & Mid(s, 6, 2) & Mid(s, 9, 2)
        Exit Function
    End If

    If InStr(s, "/") > 0 Then
        p = Split(s, "/")
        If UBound(p) >= 2 Then
            NormalizeDateKey = Right("0000" & p(2), 4) & Right("0" & p(1), 2) & Right("0" & p(0), 2)
            Exit Function
        End If
    End If

    NormalizeDateKey = DigitsOnly(s)
End Function

Function NormalizeQty(s)
    s = Trim(CStr(s))
    s = Replace(s, ",", "")
    If s = "" Then
        NormalizeQty = ""
        Exit Function
    End If

    On Error Resume Next
    Dim d : d = CDbl(s)
    If Err.Number = 0 Then
        If Abs(d - Fix(d)) < 0.000001 Then
            NormalizeQty = CStr(CLng(d))
        Else
            NormalizeQty = CStr(d)
        End If
    Else
        Err.Clear
        NormalizeQty = StripLeadingZeros(DigitsOnly(s))
    End If
    On Error GoTo 0
End Function

Function OpenPopup(sapRow)
    OpenPopup = False
    Dim attempt
    For attempt = 1 To MAX_RETRY
        ' Bring target row into view before double-click. Required for scrollable/virtual SAP grids.
        EnsureSapRowVisible sapRow
        On Error Resume Next
        g_oGrid.CurrentCellRow = sapRow
        g_oGrid.CurrentCellColumn = SAP_OPEN_COL
        g_oGrid.SelectedRows = CStr(sapRow)
        g_oGrid.DoubleClickCurrentCell
        WScript.Sleep SLEEP_LONG + (attempt - 1) * 300
        If Err.Number <> 0 Then
            WScript.Echo "  [Popup] Attempt " & attempt & " failed for SAP row " & sapRow & ": " & Err.Description
            Err.Clear : On Error GoTo 0
        Else
            On Error GoTo 0
            Dim chk : chk = ""
            On Error Resume Next
            chk = g_sapSess.findById("wnd[1]").Text
            Err.Clear : On Error GoTo 0
            If chk <> "" Then
                OpenPopup = True
                Exit Function
            End If
            WScript.Echo "  [Popup] Attempt " & attempt & " - popup not visible yet, retrying..."
            WScript.Sleep 400
        End If
    Next
End Function

Sub CancelPopup()
    On Error Resume Next
    g_sapSess.findById("wnd[1]/tbar[0]/btn[12]").Press
    WScript.Sleep 200
    Err.Clear : On Error GoTo 0
End Sub

Sub DismissPostSavePopup()
    Dim chk : chk = ""
    On Error Resume Next
    chk = g_sapSess.findById("wnd[1]").Text
    Err.Clear : On Error GoTo 0
    If chk <> "" Then
        WScript.Echo "  [POPUP] Post-save dialog detected: '" & chk & "' - dismissing."
        On Error Resume Next
        g_sapSess.findById("wnd[1]/tbar[0]/btn[0]").Press
        WScript.Sleep 300
        If Err.Number <> 0 Then
            Err.Clear
            g_sapSess.findById("wnd[1]").SendVKey 0
            WScript.Sleep 200
        End If
        Err.Clear : On Error GoTo 0
    End If
End Sub

Function ValidateRow(exExpDate, exRemarks, exDFT, exPERNR, exCUMMODE)
    Dim errs : errs = ""
    If exExpDate = "" And exRemarks = "" And exDFT = "" Then
        errs = AppendMsg(errs, "All update fields (ExpDate/Remarks/DFT) are blank")
    End If

    If exPERNR = "" Then
        errs = AppendMsg(errs, "PERNR is missing")
    ElseIf Not IsNumeric(exPERNR) Then
        errs = AppendMsg(errs, "PERNR must be numeric (got: " & exPERNR & ")")
    ElseIf Len(CStr(CLng(exPERNR))) <> 6 Then
        errs = AppendMsg(errs, "PERNR must be exactly 6 digits (got: " & exPERNR & ")")
    End If

    If exCUMMODE = "" Then
        errs = AppendMsg(errs, "CUMMODE_KEY is missing")
    ElseIf InStr(VALID_CUMMODES, "|" & exCUMMODE & "|") = 0 Then
        errs = AppendMsg(errs, "CUMMODE_KEY invalid [" & exCUMMODE & "] - allowed: EMAIL, PHONE, VISIT, SANYOG")
    End If
    ValidateRow = errs
End Function

Function AppendMsg(existing, newMsg)
    If existing = "" Then AppendMsg = newMsg Else AppendMsg = existing & " | " & newMsg
End Function

Sub WriteMatch(runID, excelRow, vendorNm, po, exMat, exLine, exSched, exQty, matchKey, keyOccur, keyTotal, sapRow, matchStatus, msg)
    If IsObject(g_matchFile) Then
        g_matchFile.WriteLine CsvLine(Array(runID, excelRow, vendorNm, po, exMat, exLine, exSched, exQty, matchKey, keyOccur, keyTotal, sapRow, matchStatus, msg))
    End If
End Sub

Sub WriteBack(excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, statusOut, errMsg)
    Dim ts : ts = FormatTS(Now())
    g_logFile.WriteLine CsvLine(Array(excelRow, po, exLine, exSched, exQty, exPERNR, exCUMMODE, statusOut, errMsg, ts))
    ' Status logged to _STATUS.csv for ultra-fast bulk update at end of run
End Sub

Sub UpdateExcelRow(excelRow, statusOut, errMsg, ts)
    ' No-op: replaced by high-speed bulk applier at pipeline completion
End Sub

Sub BumpConsecError()
    g_consecErrors = g_consecErrors + 1
    If g_consecErrors >= CONSEC_ERR_MAX Then
        WScript.Echo "[WARN] " & CONSEC_ERR_MAX & " consecutive SAP errors - pausing " & (CONSEC_ERR_WAIT / 1000) & "s..."
        WScript.Sleep CONSEC_ERR_WAIT
        g_consecErrors = 0
        Ping_SAP
    End If
End Sub

Sub Ping_SAP()
    On Error Resume Next
    Dim dummy : dummy = g_oGrid.RowCount
    Err.Clear : On Error GoTo 0
    WScript.Echo "[PING] SAP heartbeat - session alive."
End Sub

Sub WriteCheckpoint(dataRowsDone)
    On Error Resume Next
    g_chkptFile.WriteLine FormatTS(Now()) & " - Processed " & dataRowsDone & _
                          " rows. Done=" & g_Done & " SapErr=" & g_SapErr & _
                          " ValErr=" & g_ValErr & " Skip=" & g_Skipped
    WScript.Echo "[CHKPT] Checkpoint saved at work row " & dataRowsDone
    Err.Clear : On Error GoTo 0
End Sub

Function ResolveDFTKey(rawDFT)
    ResolveDFTKey = ""
    rawDFT = Trim(rawDFT)
    If rawDFT = "" Then Exit Function

    Dim num : num = ""
    If InStr(rawDFT, ".") > 0 Then
        num = Trim(Left(rawDFT, InStr(rawDFT, ".") - 1))
    ElseIf IsNumeric(rawDFT) Then
        num = CStr(CLng(rawDFT))
    End If

    Select Case num
        Case "1"  : ResolveDFTKey = "1.Problem Escalate   Single Make"
        Case "2"  : ResolveDFTKey = "2.Amendment Pending"
        Case "3"  : ResolveDFTKey = "3.No open order at vendor"
        Case "4"  : ResolveDFTKey = "4.New PO to confirm"
        Case "5"  : ResolveDFTKey = "5.Delivery to confirm"
        Case "6"  : ResolveDFTKey = "6.Partial qty delivery to confirm"
        Case "7"  : ResolveDFTKey = "7.Problem DIFOT"
        Case "8"  : ResolveDFTKey = "8.Focus on committed date"
        Case "9"  : ResolveDFTKey = "9.Requested for pull in   committed date"
        Case "10" : ResolveDFTKey = "10.Ready for dispatch"
        Case "11" : ResolveDFTKey = "11.In Transit"
        Case "12" : ResolveDFTKey = "12.GRN Pending"
        Case "13" : ResolveDFTKey = "13.Advance payment under process"
        Case "14" : ResolveDFTKey = "14.Proforma Invoice pending from vendor"
        Case "15" : ResolveDFTKey = "15.Under shipment pick up"
        Case "16" : ResolveDFTKey = "16.Delivery Kept on hold"
        Case "17" : ResolveDFTKey = "17.Planned in Sea shipment"
        Case "18" : ResolveDFTKey = "18.Raw material to be issued"
        Case "19" : ResolveDFTKey = "19.Quality Issues"
        Case "20" : ResolveDFTKey = "20.Delivery held by supplier   Inventory"
        Case "21" : ResolveDFTKey = "21.EQ Pending"
        Case "22" : ResolveDFTKey = "22.Issue   M.E   Electronics"
        Case "23" : ResolveDFTKey = "23.Issue   M.E   Mechanical"
        Case "24" : ResolveDFTKey = "24.Issue   Designer"
        Case "25" : ResolveDFTKey = "25.EOL / Obsoleted Part"
        Case "26" : ResolveDFTKey = "26.STQC / BIS issue"
        Case "27" : ResolveDFTKey = "27.Partial qty In transit"
        Case "28" : ResolveDFTKey = "28.Down level material   Shortage"
        Case "29" : ResolveDFTKey = "29.Under date code confirmation"
        Case "30" : ResolveDFTKey = "30.Issue In transit"
        Case "31" : ResolveDFTKey = "31.PO Unreleased"
        Case Else : ResolveDFTKey = rawDFT
    End Select
End Function

Function FormatTS(dt)
    FormatTS = Right("0" & Day(dt), 2) & "." & Right("0" & Month(dt), 2) & "." & Year(dt) & _
               " " & Right("0" & Hour(dt), 2) & ":" & Right("0" & Minute(dt), 2) & ":" & Right("0" & Second(dt), 2)
End Function

'===============================================================================
' CSV helpers
'===============================================================================
Function ReadCsvFile(path)
    Dim stm : Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2
    stm.Charset = "utf-8"
    stm.Open
    stm.LoadFromFile path
    Dim text : text = stm.ReadText
    stm.Close

    text = Replace(text, vbCrLf, vbLf)
    text = Replace(text, vbCr, vbLf)
    If Len(text) > 0 Then
        If AscW(Left(text, 1)) = &HFEFF Then text = Mid(text, 2)
    End If

    Dim lines : lines = Split(text, vbLf)
    Dim result(), count, i
    ReDim result(0)
    count = -1
    For i = 0 To UBound(lines)
        If i < UBound(lines) Or Trim(lines(i)) <> "" Then
            count = count + 1
            ReDim Preserve result(count)
            result(count) = ParseCsvLine(lines(i))
        End If
    Next

    If count < 0 Then
        ReadCsvFile = Empty
    Else
        ReadCsvFile = result
    End If
End Function

Function ParseCsvLine(line)
    Dim fields(), field, inQuotes, i, ch, nextCh, n
    ReDim fields(0)
    field = "" : inQuotes = False : n = 0

    For i = 1 To Len(line)
        ch = Mid(line, i, 1)
        If ch = """" Then
            If inQuotes And i < Len(line) Then
                nextCh = Mid(line, i + 1, 1)
                If nextCh = """" Then
                    field = field & """"
                    i = i + 1
                Else
                    inQuotes = Not inQuotes
                End If
            Else
                inQuotes = Not inQuotes
            End If
        ElseIf ch = "," And Not inQuotes Then
            fields(n) = field
            n = n + 1
            ReDim Preserve fields(n)
            field = ""
        Else
            field = field & ch
        End If
    Next
    fields(n) = field
    ParseCsvLine = fields
End Function

Function CsvValue(header, row, name)
    Dim i
    CsvValue = ""
    For i = 0 To UBound(header)
        If LCase(Trim(header(i))) = LCase(name) Then
            If i <= UBound(row) Then CsvValue = Trim(CStr(row(i)))
            Exit Function
        End If
    Next
End Function

Function CsvLine(values)
    Dim out(), i
    ReDim out(UBound(values))
    For i = 0 To UBound(values)
        out(i) = CsvEscape(CStr(values(i)))
    Next
    CsvLine = Join(out, ",")
End Function

Function CsvEscape(value)
    value = Replace(value, """", """""")
    If InStr(value, ",") > 0 Or InStr(value, """") > 0 Or InStr(value, vbCr) > 0 Or InStr(value, vbLf) > 0 Then
        CsvEscape = """" & value & """"
    Else
        CsvEscape = value
    End If
End Function
