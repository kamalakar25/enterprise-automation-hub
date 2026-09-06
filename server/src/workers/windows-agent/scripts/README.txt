Place your production automation scripts in this folder (or point SCRIPTS_DIR in .env to the folder that contains them):

  1. SAP_Daily_Updater_v5_LO.vbs       (the VBS you provided)
  2. update_excel_structure.py        (the Python engine you provided — rename from whatever current name you have, e.g. engine.py, to this exact filename, OR edit the VBS_NAME / PY_NAME constants in server.js to match)

On first run of the agent it will report missing files at GET /health.
