// ============================================================================
//  SnipeDataExporter.cs — ATAS indicator that writes the loaded chart history
//  to CSV for the Python backtest (bars + footprint summary + optional levels)
//  Add it to a 1-minute XAUUSD / GC chart with as many days loaded as your
//  plan allows, wait for "export done" in the ATAS log, then upload the files.
// ============================================================================
using System;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using ATAS.Indicators;
using Utils.Common.Logging;

namespace SnipeTrading
{
    [DisplayName("Snipe Data Exporter (CSV)")]
    public class SnipeDataExporter : Indicator
    {
        [Display(Name = "Output folder", GroupName = "Export", Order = 1)] public string Folder { get; set; } = @"C:\snipe_export";
        [Display(Name = "Export price levels (footprint)", GroupName = "Export", Order = 2)] public bool ExportLevels { get; set; } = true;
        [Display(Name = "Re-export on every recalculation", GroupName = "Export", Order = 3)] public bool ReExport { get; set; } = false;

        private bool _done; private readonly CultureInfo _ci = CultureInfo.InvariantCulture;
        private readonly ValueDataSeries _dummy = new("Exporter") { VisualType = VisualMode.Hide };

        public SnipeDataExporter() { DenyToChangePanel = true; DataSeries[0] = _dummy; }
        protected override void OnRecalculate() { if (ReExport) _done = false; }

        protected override void OnCalculate(int bar, decimal value)
        {
            // export once, when the last historical bar has been processed
            if (_done || bar < CurrentBar - 1) return;
            _done = true;
            try
            {
                Directory.CreateDirectory(Folder);
                string sym = InstrumentInfo?.Instrument ?? "SYMBOL";
                string tf = ChartInfo?.TimeFrame ?? "TF";
                string stamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmm");
                string barsPath = Path.Combine(Folder, $"{sym}_{tf}_bars_{stamp}.csv");
                string lvlPath = Path.Combine(Folder, $"{sym}_{tf}_levels_{stamp}.csv");
                using var bw = new StreamWriter(barsPath, false, Encoding.UTF8);
                bw.WriteLine("time_utc,open,high,low,close,volume,delta,bid,ask,max_delta,min_delta,poc_price,poc_volume,ticks");
                StreamWriter lw = null;
                if (ExportLevels) { lw = new StreamWriter(lvlPath, false, Encoding.UTF8); lw.WriteLine("time_utc,price,volume,bid,ask"); }
                for (int i = 0; i < CurrentBar; i++)
                {
                    var c = GetCandle(i); var t = c.Time.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", _ci);
                    var poc = c.MaxVolumePriceInfo;
                    bw.WriteLine(string.Join(",", t, F(c.Open), F(c.High), F(c.Low), F(c.Close), F(c.Volume), F(c.Delta), F(c.Bid), F(c.Ask), F(c.MaxDelta), F(c.MinDelta), F(poc?.Price ?? 0), F(poc?.Volume ?? 0), F(c.Ticks)));
                    if (lw != null)
                        foreach (var l in c.GetAllPriceLevels().OrderBy(x => x.Price))
                            lw.WriteLine(string.Join(",", t, F(l.Price), F(l.Volume), F(l.Bid), F(l.Ask)));
                }
                lw?.Dispose();
                this.LogInfo($"Snipe export done: {barsPath}" + (ExportLevels ? $" and {lvlPath}" : ""));
            }
            catch (Exception ex) { this.LogWarn("Snipe export failed: " + ex.Message); }
        }
        private string F(decimal d) => d.ToString("0.########", _ci);
    }
}
