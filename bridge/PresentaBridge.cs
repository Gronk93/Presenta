using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PresentaBridge
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool created;
            bool eventCreated;
            using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\PresentaBridge.Show", out eventCreated))
            using (var mutex = new Mutex(true, "Local\\PresentaBridge", out created))
            {
                if (!created)
                {
                    showEvent.Set();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new BridgeForm(showEvent));
            }
        }
    }

    internal sealed class BridgeForm : Form
    {
        private readonly OverlayForm overlay;
        private readonly BridgeServer server;
        private readonly NotifyIcon trayIcon;
        private readonly Label statusLabel;
        private readonly Label deviceLabel;
        private readonly Label codeLabel;
        private readonly ComboBox screenPicker;
        private string pairingCode;
        private readonly string pairingCodePath;
        private readonly EventWaitHandle showEvent;
        private readonly Thread showThread;
        private readonly BluetoothBridge bluetooth;
        private volatile bool exitRequested;

        public BridgeForm(EventWaitHandle showEvent)
        {
            this.showEvent = showEvent;
            pairingCodePath = GetPairingCodePath();
            pairingCode = LoadOrCreatePairingCode(pairingCodePath);
            Text = "Presenta Bridge";
            Icon = SystemIcons.Application;
            BackColor = Color.FromArgb(243, 240, 232);
            ForeColor = Color.FromArgb(23, 28, 37);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
            ClientSize = new Size(510, 425);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            var header = new Label
            {
                Text = "PRESENTA  /  BRIDGE PARA WINDOWS",
                AutoSize = true,
                Location = new Point(28, 25),
                ForeColor = Color.FromArgb(79, 66, 189),
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold)
            };

            var title = new Label
            {
                Text = "Conecta Android con tu pantalla",
                AutoSize = true,
                Location = new Point(25, 55),
                Font = new Font("Segoe UI Semibold", 20f, FontStyle.Bold)
            };

            var codeCaption = new Label
            {
                Text = "CONTRASEÑA DEL BRIDGE",
                AutoSize = true,
                Location = new Point(29, 115),
                ForeColor = Color.FromArgb(110, 113, 111),
                Font = new Font("Segoe UI", 8f, FontStyle.Bold)
            };

            codeLabel = new Label
            {
                Text = FormatCode(pairingCode),
                AutoSize = true,
                Location = new Point(25, 137),
                Font = new Font("Consolas", 27f, FontStyle.Bold)
            };

            var copyButton = MakeButton("Copiar", new Point(318, 137), new Size(76, 41));
            copyButton.Click += delegate
            {
                Clipboard.SetText(pairingCode);
                statusLabel.Text = "Contraseña copiada";
            };

            var renewButton = MakeButton("Cambiar", new Point(400, 137), new Size(82, 41));
            renewButton.Click += delegate { RenewPairingCode(); };

            var screenCaption = new Label
            {
                Text = "Pantalla donde aparecerá el láser",
                AutoSize = true,
                Location = new Point(29, 210),
                ForeColor = Color.FromArgb(110, 113, 111)
            };

            screenPicker = new ComboBox
            {
                Location = new Point(29, 233),
                Size = new Size(315, 34),
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            PopulateScreens();
            screenPicker.SelectedIndexChanged += delegate
            {
                if (screenPicker.SelectedIndex >= 0) overlay.UseScreen(screenPicker.SelectedIndex);
            };

            var hideButton = MakeButton("Ocultar", new Point(358, 231), new Size(124, 36));
            hideButton.Click += delegate { Hide(); };

            deviceLabel = new Label
            {
                Text = "Bluetooth: buscando un Android emparejado…",
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleLeft,
                Location = new Point(29, 290),
                Size = new Size(453, 24),
                ForeColor = Color.FromArgb(110, 113, 111),
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold)
            };

            statusLabel = new Label
            {
                Text = "Iniciando servicio local…",
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleLeft,
                Location = new Point(29, 324),
                Size = new Size(453, 24),
                ForeColor = Color.FromArgb(22, 122, 89)
            };

            var helpLabel = new Label
            {
                Text = "1. Abre Presenta en la computadora  ·  2. Conecta el celular por Internet  ·  3. Escribe esta contraseña en la PWA",
                AutoSize = false,
                Location = new Point(29, 363),
                Size = new Size(453, 38),
                ForeColor = Color.FromArgb(110, 113, 111),
                Font = new Font("Segoe UI", 8.2f)
            };

            Controls.AddRange(new Control[] { header, title, codeCaption, codeLabel, copyButton, renewButton, screenCaption, screenPicker, hideButton, deviceLabel, statusLabel, helpLabel });

            overlay = new OverlayForm();
            overlay.UseScreen(0);
            overlay.Show();

            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir Presenta Bridge", null, delegate { ShowWindow(); });
            menu.Items.Add("Copiar contraseña", null, delegate { Clipboard.SetText(pairingCode); });
            menu.Items.Add("Cambiar contraseña", null, delegate { RenewPairingCode(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Salir", null, delegate { exitRequested = true; Close(); });

            trayIcon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "Presenta Bridge",
                Visible = true,
                ContextMenuStrip = menu
            };
            trayIcon.DoubleClick += delegate { ShowWindow(); };

            var commands = new CommandRouter(overlay, SetDeviceStatus);
            server = new BridgeServer(delegate { return pairingCode; }, commands, SetBridgeStatus);
            server.Start();
            bluetooth = new BluetoothBridge(delegate { return pairingCode; }, commands, SetBridgeStatus, SetDeviceStatus);
            bluetooth.Start();
            showThread = new Thread(ShowSignalLoop) { IsBackground = true, Name = "Presenta Bridge Show Signal" };
            showThread.Start();
        }

        private Button MakeButton(string text, Point location, Size size)
        {
            return new Button
            {
                Text = text,
                Location = location,
                Size = size,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(255, 254, 250),
                Cursor = Cursors.Hand
            };
        }

        private void PopulateScreens()
        {
            screenPicker.Items.Clear();
            for (int i = 0; i < Screen.AllScreens.Length; i++)
            {
                Screen screen = Screen.AllScreens[i];
                screenPicker.Items.Add("Pantalla " + (i + 1) + (screen.Primary ? " · Principal" : "") + "  " + screen.Bounds.Width + "×" + screen.Bounds.Height);
            }
            if (screenPicker.Items.Count > 0) screenPicker.SelectedIndex = 0;
        }

        private void ShowWindow()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ShowSignalLoop()
        {
            while (!exitRequested)
            {
                try { showEvent.WaitOne(); }
                catch (ObjectDisposedException) { return; }
                if (exitRequested || IsDisposed) return;
                try { BeginInvoke(new MethodInvoker(ShowWindow)); }
                catch (InvalidOperationException) { return; }
            }
        }

        private void SetDeviceStatus(string name, string platform)
        {
            if (IsDisposed) return;
            MethodInvoker update = delegate
            {
                deviceLabel.Text = "Celular: " + name + "  ·  " + platform + "  ·  señal " + DateTime.Now.ToString("HH:mm:ss");
                deviceLabel.ForeColor = Color.FromArgb(22, 122, 89);
            };
            if (!IsHandleCreated || !InvokeRequired) update(); else BeginInvoke(update);
        }

        private void SetBridgeStatus(string text, bool ok)
        {
            if (IsDisposed) return;
            MethodInvoker update = delegate
            {
                statusLabel.Text = text;
                statusLabel.ForeColor = ok ? Color.FromArgb(22, 122, 89) : Color.FromArgb(185, 68, 80);
            };
            if (!IsHandleCreated || !InvokeRequired) update(); else BeginInvoke(update);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!exitRequested && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            exitRequested = true;
            showEvent.Set();
            server.Dispose();
            bluetooth.Dispose();
            overlay.Close();
            trayIcon.Visible = false;
            trayIcon.Dispose();
            base.OnFormClosing(e);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (WindowState == FormWindowState.Minimized) Hide();
        }

        private void RenewPairingCode()
        {
            pairingCode = CreatePairingCode();
            SavePairingCode(pairingCodePath, pairingCode);
            codeLabel.Text = FormatCode(pairingCode);
            bluetooth.Restart();
            deviceLabel.Text = "Bluetooth: clave renovada; esperando reconexión…";
            deviceLabel.ForeColor = Color.FromArgb(110, 113, 111);
            statusLabel.Text = "Contraseña cambiada. Escríbela de nuevo en Android o en la página.";
            statusLabel.ForeColor = Color.FromArgb(22, 122, 89);
        }

        private static string GetPairingCodePath()
        {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Presenta");
            return Path.Combine(folder, "bridge-password.txt");
        }

        private static string LoadOrCreatePairingCode(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    string existing = File.ReadAllText(path).Trim();
                    if (IsValidPairingCode(existing)) return existing;
                }
                string created = CreatePairingCode();
                SavePairingCode(path, created);
                return created;
            }
            catch
            {
                return CreatePairingCode();
            }
        }

        private static void SavePairingCode(string path, string value)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, value);
            }
            catch { }
        }

        private static string CreatePairingCode()
        {
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            var bytes = new byte[8];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            var result = new char[8];
            for (int i = 0; i < result.Length; i++) result[i] = alphabet[bytes[i] & 31];
            return new string(result);
        }

        private static bool IsValidPairingCode(string value)
        {
            if (value == null || value.Length != 8) return false;
            foreach (char item in value)
                if (!(item >= 'A' && item <= 'Z') && !(item >= '2' && item <= '9')) return false;
            return true;
        }

        private static string FormatCode(string code)
        {
            return code.Substring(0, 4) + "  " + code.Substring(4);
        }
    }

    internal sealed class DrawingStroke
    {
        public string Id;
        public Color Color;
        public float Width;
        public readonly List<PointF> Points = new List<PointF>();
    }

    internal sealed class OverlayForm : Form
    {
        private const int WS_EX_TRANSPARENT = 0x20;
        private const int WS_EX_TOOLWINDOW = 0x80;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private double pointerX = .5;
        private double pointerY = .5;
        private double targetPointerX = .5;
        private double targetPointerY = .5;
        private bool laserActive;
        private bool pointerVisible;
        private bool freezeActive;
        private Bitmap freezeFrame;
        private string boardMode = "transparent";
        private readonly List<DrawingStroke> drawingStrokes = new List<DrawingStroke>();
        private readonly System.Windows.Forms.Timer pointerMotionTimer;
        private readonly System.Windows.Forms.Timer safetyTimer;

        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.Fuchsia;
            TransparencyKey = Color.Fuchsia;
            DoubleBuffered = true;
            Cursor = Cursors.Default;
            pointerMotionTimer = new System.Windows.Forms.Timer { Interval = 15 };
            pointerMotionTimer.Tick += delegate
            {
                Rectangle previousBounds = PointerBounds(pointerX, pointerY);
                double distanceX = targetPointerX - pointerX;
                double distanceY = targetPointerY - pointerY;
                pointerX = Math.Max(0, Math.Min(1, pointerX + distanceX * .34));
                pointerY = Math.Max(0, Math.Min(1, pointerY + distanceY * .34));
                if (Math.Abs(distanceX) < .00008 && Math.Abs(distanceY) < .00008)
                {
                    pointerX = targetPointerX;
                    pointerY = targetPointerY;
                    pointerMotionTimer.Stop();
                }
                if (laserActive && pointerVisible)
                    Invalidate(Rectangle.Union(previousBounds, PointerBounds(pointerX, pointerY)));
            };
            safetyTimer = new System.Windows.Forms.Timer { Interval = 7000 };
            safetyTimer.Tick += delegate
            {
                safetyTimer.Stop();
                Rectangle pointerBounds = PointerBounds(pointerX, pointerY);
                pointerVisible = false;
                laserActive = false;
                Invalidate(pointerBounds);
            };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
                return parameters;
            }
        }

        public void UseScreen(int index)
        {
            RunOnUi(delegate
            {
                Screen[] screens = Screen.AllScreens;
                if (index < 0 || index >= screens.Length) index = 0;
                ReleaseFreezeFrame();
                freezeActive = false;
                Bounds = screens[index].Bounds;
                EnsureTopmostCore();
                Invalidate();
            });
        }

        private void EnsureTopmostCore()
        {
            if (!Visible) Show();
            SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }

        public void EnsureTopmost()
        {
            RunOnUi(delegate
            {
                EnsureTopmostCore();
                Invalidate();
            });
        }

        public void SetPointer(double x, double y)
        {
            RunOnUi(delegate
            {
                targetPointerX = Math.Max(0, Math.Min(1, x));
                targetPointerY = Math.Max(0, Math.Min(1, y));
                BeginPointerMotion();
            });
        }

        public void MovePointer(double dx, double dy)
        {
            RunOnUi(delegate
            {
                targetPointerX = Math.Max(0, Math.Min(1, targetPointerX + dx));
                targetPointerY = Math.Max(0, Math.Min(1, targetPointerY + dy));
                BeginPointerMotion();
            });
        }

        private void BeginPointerMotion()
        {
            EnsureTopmostCore();
            pointerVisible = laserActive;
            if (!pointerMotionTimer.Enabled) pointerMotionTimer.Start();
        }

        private Rectangle PointerBounds(double x, double y)
        {
            int pixelX = (int)Math.Round(x * ClientSize.Width);
            int pixelY = (int)Math.Round(y * ClientSize.Height);
            return new Rectangle(pixelX - 18, pixelY - 18, 36, 36);
        }

        public void SetLaser(bool active)
        {
            RunOnUi(delegate
            {
                Rectangle pointerBounds = PointerBounds(pointerX, pointerY);
                laserActive = active;
                pointerVisible = active;
                EnsureTopmostCore();
                Invalidate(pointerBounds);
            });
        }

        public void SetFreeze(bool active)
        {
            RunOnUi(delegate
            {
                if (active && !freezeActive)
                {
                    Bitmap captured = CaptureSelectedScreen();
                    if (captured != null)
                    {
                        ReleaseFreezeFrame();
                        freezeFrame = captured;
                        freezeActive = true;
                    }
                }
                else if (!active)
                {
                    freezeActive = false;
                    ReleaseFreezeFrame();
                }
                EnsureTopmostCore();
                Invalidate();
            });
        }

        private Bitmap CaptureSelectedScreen()
        {
            Bitmap captured = null;
            bool wasVisible = Visible;
            try
            {
                if (wasVisible)
                {
                    Hide();
                    Application.DoEvents();
                }
                captured = new Bitmap(Math.Max(1, Bounds.Width), Math.Max(1, Bounds.Height));
                using (Graphics graphics = Graphics.FromImage(captured))
                {
                    graphics.CopyFromScreen(Bounds.Location, Point.Empty, Bounds.Size, CopyPixelOperation.SourceCopy);
                }
                return captured;
            }
            catch
            {
                if (captured != null) captured.Dispose();
                return null;
            }
            finally
            {
                if (wasVisible) EnsureTopmostCore();
            }
        }

        private void ReleaseFreezeFrame()
        {
            if (freezeFrame == null) return;
            freezeFrame.Dispose();
            freezeFrame = null;
        }

        public void SetBoard(string mode)
        {
            RunOnUi(delegate
            {
                if (mode != "transparent" && mode != "white" && mode != "black") mode = "transparent";
                boardMode = mode;
                EnsureTopmostCore();
                Invalidate();
            });
        }

        public void ClearDrawing()
        {
            RunOnUi(delegate
            {
                drawingStrokes.Clear();
                EnsureTopmostCore();
                Invalidate();
            });
        }

        public void ApplyPen(string phase, string id, double x, double y, string color, float width, string tool)
        {
            RunOnUi(delegate
            {
                EnsureTopmostCore();
                float normalizedX = (float)Math.Max(0, Math.Min(1, x));
                float normalizedY = (float)Math.Max(0, Math.Min(1, y));
                if (tool == "eraser")
                {
                    if (phase == "end") return;
                    float radius = width <= 3 ? .018f : width <= 7 ? .032f : .052f;
                    drawingStrokes.RemoveAll(delegate(DrawingStroke stroke)
                    {
                        foreach (PointF point in stroke.Points)
                        {
                            float dx = point.X - normalizedX;
                            float dy = point.Y - normalizedY;
                            if (Math.Sqrt(dx * dx + dy * dy) <= radius) return true;
                        }
                        return false;
                    });
                    Invalidate();
                    return;
                }

                DrawingStroke active = drawingStrokes.Find(delegate(DrawingStroke stroke) { return stroke.Id == id; });
                if (phase == "start")
                {
                    active = new DrawingStroke { Id = id, Color = ParsePenColor(color), Width = (float)Math.Max(2, Math.Min(18, width)) };
                    active.Points.Add(new PointF(normalizedX, normalizedY));
                    drawingStrokes.Add(active);
                }
                else if (phase == "move" && active != null)
                {
                    active.Points.Add(new PointF(normalizedX, normalizedY));
                }
                Invalidate();
            });
        }

        private static Color ParsePenColor(string value)
        {
            if (string.Equals(value, "#2563eb", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(37, 99, 235);
            if (string.Equals(value, "#111827", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(17, 24, 39);
            return Color.FromArgb(239, 51, 64);
        }

        public void Touch()
        {
            RunOnUi(delegate
            {
                safetyTimer.Stop();
                safetyTimer.Start();
                EnsureTopmostCore();
            });
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (freezeActive && freezeFrame != null) e.Graphics.DrawImage(freezeFrame, e.ClipRectangle, e.ClipRectangle, GraphicsUnit.Pixel);
            else if (boardMode == "white") e.Graphics.Clear(Color.FromArgb(255, 254, 250));
            else if (boardMode == "black") e.Graphics.Clear(Color.FromArgb(16, 19, 24));
            else e.Graphics.Clear(Color.Fuchsia);
            DrawAnnotations(e.Graphics);
            if (!laserActive || !pointerVisible) return;
            float x = (float)(pointerX * ClientSize.Width);
            float y = (float)(pointerY * ClientSize.Height);
            using (var halo = new SolidBrush(Color.FromArgb(55, 235, 25, 45)))
            using (var core = new SolidBrush(Color.FromArgb(255, 235, 25, 45)))
            {
                e.Graphics.FillEllipse(halo, x - 13, y - 13, 26, 26);
                e.Graphics.FillEllipse(core, x - 5, y - 5, 10, 10);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                pointerMotionTimer.Dispose();
                safetyTimer.Dispose();
                ReleaseFreezeFrame();
            }
            base.Dispose(disposing);
        }

        private void DrawAnnotations(Graphics graphics)
        {
            foreach (DrawingStroke stroke in drawingStrokes)
            {
                if (stroke.Points.Count == 0) continue;
                if (stroke.Points.Count == 1)
                {
                    PointF point = stroke.Points[0];
                    float x = point.X * ClientSize.Width;
                    float y = point.Y * ClientSize.Height;
                    using (var brush = new SolidBrush(stroke.Color))
                        graphics.FillEllipse(brush, x - stroke.Width / 2, y - stroke.Width / 2, stroke.Width, stroke.Width);
                    continue;
                }
                PointF[] points = new PointF[stroke.Points.Count];
                for (int index = 0; index < stroke.Points.Count; index++)
                    points[index] = new PointF(stroke.Points[index].X * ClientSize.Width, stroke.Points[index].Y * ClientSize.Height);
                using (var pen = new Pen(stroke.Color, stroke.Width))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    pen.LineJoin = LineJoin.Round;
                    graphics.DrawLines(pen, points);
                }
            }
        }

        private void RunOnUi(MethodInvoker action)
        {
            if (IsDisposed) return;
            if (InvokeRequired) BeginInvoke(action); else action();
        }
    }

    internal sealed class CommandRouter
    {
        private readonly OverlayForm overlay;
        private readonly Action<string, string> deviceStatus;

        public CommandRouter(OverlayForm overlay, Action<string, string> deviceStatus)
        {
            this.overlay = overlay;
            this.deviceStatus = deviceStatus;
        }

        public void Execute(Dictionary<string, object> command)
        {
            overlay.Touch();
            string type = command.ContainsKey("type") ? Convert.ToString(command["type"]) : "";
            if (type == "ping") return;
            if (type == "device")
            {
                string name = command.ContainsKey("name") ? Convert.ToString(command["name"]) : "Celular";
                string platform = command.ContainsKey("platform") ? Convert.ToString(command["platform"]) : "Móvil";
                if (name.Length > 48) name = name.Substring(0, 48);
                if (platform.Length > 32) platform = platform.Substring(0, 32);
                deviceStatus(name, platform);
                return;
            }
            if (type == "pointer")
            {
                bool relative = command.ContainsKey("relative") && Convert.ToBoolean(command["relative"]);
                if (relative && command.ContainsKey("dx") && command.ContainsKey("dy"))
                    overlay.MovePointer(Convert.ToDouble(command["dx"]), Convert.ToDouble(command["dy"]));
                else
                    overlay.SetPointer(Convert.ToDouble(command["x"]), Convert.ToDouble(command["y"]));
                return;
            }
            if (type == "laser")
            {
                overlay.SetLaser(Convert.ToBoolean(command["active"]));
                return;
            }
            if (type == "blackout")
            {
                // Conservamos el nombre del mensaje para que la PWA siga siendo
                // compatible con instalaciones anteriores del Bridge.
                overlay.SetFreeze(Convert.ToBoolean(command["active"]));
                return;
            }
            if (type == "slide")
            {
                int direction = Convert.ToInt32(command["direction"]);
                Keyboard.Send(direction >= 0 ? Keyboard.VK_RIGHT : Keyboard.VK_LEFT);
                return;
            }
            if (type == "presentation")
            {
                string action = command.ContainsKey("action") ? Convert.ToString(command["action"]) : "";
                if (action == "start")
                {
                    Keyboard.ControlPowerPoint(true);
                    overlay.EnsureTopmost();
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(850);
                        overlay.EnsureTopmost();
                        Thread.Sleep(900);
                        overlay.EnsureTopmost();
                    });
                }
                else if (action == "stop") Keyboard.ControlPowerPoint(false);
                else throw new InvalidOperationException("Unknown presentation action");
                return;
            }
            if (type == "board")
            {
                overlay.SetBoard(Convert.ToString(command["mode"]));
                return;
            }
            if (type == "clear-drawing")
            {
                overlay.ClearDrawing();
                return;
            }
            if (type == "pen")
            {
                overlay.ApplyPen(
                    Convert.ToString(command["phase"]),
                    Convert.ToString(command["id"]),
                    Convert.ToDouble(command["x"]),
                    Convert.ToDouble(command["y"]),
                    Convert.ToString(command["color"]),
                    Convert.ToSingle(command["width"]),
                    Convert.ToString(command["tool"]));
                return;
            }
            throw new InvalidOperationException("Unknown command");
        }
    }

    internal sealed class BluetoothBridge : IDisposable
    {
        public static readonly Guid ServiceId = new Guid("A52F7B13-6C89-4E28-9D14-8BFD76C21940");
        private readonly Func<string> password;
        private readonly CommandRouter commands;
        private readonly Action<string, bool> status;
        private readonly Action<string, string> deviceStatus;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private readonly string preferredDevicePath;
        private Thread worker;
        private volatile bool running;
        private volatile int generation;
        private Socket activeSocket;

        public BluetoothBridge(Func<string> password, CommandRouter commands, Action<string, bool> status, Action<string, string> deviceStatus)
        {
            this.password = password;
            this.commands = commands;
            this.status = status;
            this.deviceStatus = deviceStatus;
            preferredDevicePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Presenta", "bluetooth-device.txt");
        }

        public void Start()
        {
            if (running) return;
            running = true;
            worker = new Thread(ConnectLoop) { IsBackground = true, Name = "Presenta Bluetooth" };
            worker.Start();
        }

        public void Restart()
        {
            generation++;
            CloseActiveSocket();
        }

        private void ConnectLoop()
        {
            status("Bluetooth activo · abre Presenta en Android", true);
            while (running)
            {
                bool foundPhone = false;
                foreach (BluetoothDevice candidate in BluetoothDevices.FindPairedPhones(ReadPreferredAddress()))
                {
                    if (!running) return;
                    foundPhone = true;
                    int attemptGeneration = generation;
                    Socket socket = null;
                    try
                    {
                        socket = new Socket((AddressFamily)32, SocketType.Stream, (ProtocolType)3);
                        activeSocket = socket;
                        IAsyncResult attempt = socket.BeginConnect(new BluetoothEndPoint(candidate.Address, ServiceId), null, null);
                        if (!attempt.AsyncWaitHandle.WaitOne(6500) || attemptGeneration != generation)
                        {
                            socket.Close();
                            continue;
                        }
                        socket.EndConnect(attempt);
                        socket.ReceiveTimeout = 16000;
                        socket.SendTimeout = 6000;
                        HandleConnection(socket, candidate);
                    }
                    catch (SocketException) { }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                    catch (Exception error)
                    {
                        if (running) status("Bluetooth: " + error.Message, false);
                    }
                    finally
                    {
                        if (ReferenceEquals(activeSocket, socket)) activeSocket = null;
                        try { if (socket != null) socket.Close(); } catch { }
                    }
                }

                if (running)
                {
                    status(foundPhone
                        ? "Bluetooth listo · abre la app Android para conectar"
                        : "Bluetooth listo · primero empareja el celular en Windows", true);
                    for (int i = 0; i < 10 && running; i++) Thread.Sleep(500);
                }
            }
        }

        private void HandleConnection(Socket socket, BluetoothDevice candidate)
        {
            using (var stream = new NetworkStream(socket, false))
            using (var reader = new StreamReader(stream, new UTF8Encoding(false), false, 4096, true))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true, NewLine = "\n" })
            {
                string authLine = reader.ReadLine();
                if (string.IsNullOrEmpty(authLine) || authLine.Length > 4096) return;
                var auth = serializer.Deserialize<Dictionary<string, object>>(authLine);
                string type = auth.ContainsKey("type") ? Convert.ToString(auth["type"]) : "";
                string suppliedPassword = auth.ContainsKey("password") ? Convert.ToString(auth["password"]) : "";
                if (type != "auth" || !string.Equals(suppliedPassword, password(), StringComparison.Ordinal))
                {
                    writer.WriteLine("{\"type\":\"auth\",\"ok\":false,\"error\":\"invalid_password\"}");
                    status("Android encontrado · contraseña incorrecta", false);
                    return;
                }

                string deviceName = auth.ContainsKey("name") ? Convert.ToString(auth["name"]) : candidate.Name;
                string platform = auth.ContainsKey("platform") ? Convert.ToString(auth["platform"]) : "Android";
                if (string.IsNullOrWhiteSpace(deviceName)) deviceName = candidate.Name;
                writer.WriteLine("{\"type\":\"auth\",\"ok\":true,\"version\":\"0.8.2\"}");
                SavePreferredAddress(candidate.Address);
                deviceStatus(deviceName, platform + " · Bluetooth");
                status("Bluetooth conectado · " + deviceName, true);

                while (running && socket.Connected)
                {
                    string line = reader.ReadLine();
                    if (line == null) return;
                    if (line.Length == 0) continue;
                    if (line.Length > 32768) throw new InvalidDataException("Comando Bluetooth demasiado grande");
                    var command = serializer.Deserialize<Dictionary<string, object>>(line);
                    commands.Execute(command);
                    string commandType = command.ContainsKey("type") ? Convert.ToString(command["type"]) : "orden";
                    if (commandType != "ping") status("Bluetooth conectado · última orden " + DateTime.Now.ToString("HH:mm:ss"), true);
                }
            }
        }

        private ulong ReadPreferredAddress()
        {
            try
            {
                ulong value;
                if (File.Exists(preferredDevicePath) && ulong.TryParse(File.ReadAllText(preferredDevicePath).Trim(), out value)) return value;
            }
            catch { }
            return 0;
        }

        private void SavePreferredAddress(ulong address)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(preferredDevicePath));
                File.WriteAllText(preferredDevicePath, address.ToString());
            }
            catch { }
        }

        private void CloseActiveSocket()
        {
            Socket socket = activeSocket;
            if (socket == null) return;
            try { socket.Close(); } catch { }
        }

        public void Dispose()
        {
            running = false;
            generation++;
            CloseActiveSocket();
        }
    }

    internal sealed class BluetoothEndPoint : EndPoint
    {
        private readonly ulong address;
        private readonly Guid serviceId;

        public BluetoothEndPoint(ulong address, Guid serviceId)
        {
            this.address = address;
            this.serviceId = serviceId;
        }

        public override AddressFamily AddressFamily { get { return (AddressFamily)32; } }

        public override SocketAddress Serialize()
        {
            var socketAddress = new SocketAddress(AddressFamily, 40);
            byte[] addressBytes = BitConverter.GetBytes(address);
            for (int i = 0; i < addressBytes.Length; i++) socketAddress[8 + i] = addressBytes[i];
            byte[] guidBytes = serviceId.ToByteArray();
            for (int i = 0; i < guidBytes.Length; i++) socketAddress[16 + i] = guidBytes[i];
            return socketAddress;
        }

        public override EndPoint Create(SocketAddress socketAddress)
        {
            return this;
        }
    }

    internal sealed class BluetoothDevice
    {
        public ulong Address;
        public string Name;
        public uint ClassOfDevice;
    }

    internal static class BluetoothDevices
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct BLUETOOTH_DEVICE_SEARCH_PARAMS
        {
            public int dwSize;
            [MarshalAs(UnmanagedType.Bool)] public bool fReturnAuthenticated;
            [MarshalAs(UnmanagedType.Bool)] public bool fReturnRemembered;
            [MarshalAs(UnmanagedType.Bool)] public bool fReturnUnknown;
            [MarshalAs(UnmanagedType.Bool)] public bool fReturnConnected;
            [MarshalAs(UnmanagedType.Bool)] public bool fIssueInquiry;
            public byte cTimeoutMultiplier;
            public IntPtr hRadio;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct BLUETOOTH_DEVICE_INFO
        {
            public int dwSize;
            public ulong Address;
            public uint ulClassofDevice;
            [MarshalAs(UnmanagedType.Bool)] public bool fConnected;
            [MarshalAs(UnmanagedType.Bool)] public bool fRemembered;
            [MarshalAs(UnmanagedType.Bool)] public bool fAuthenticated;
            public SYSTEMTIME stLastSeen;
            public SYSTEMTIME stLastUsed;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SYSTEMTIME
        {
            public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds;
        }

        [DllImport("bthprops.cpl", SetLastError = true)]
        private static extern IntPtr BluetoothFindFirstDevice(ref BLUETOOTH_DEVICE_SEARCH_PARAMS search, ref BLUETOOTH_DEVICE_INFO deviceInfo);

        [DllImport("bthprops.cpl", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool BluetoothFindNextDevice(IntPtr findHandle, ref BLUETOOTH_DEVICE_INFO deviceInfo);

        [DllImport("bthprops.cpl")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool BluetoothFindDeviceClose(IntPtr findHandle);

        public static List<BluetoothDevice> FindPairedPhones(ulong preferredAddress)
        {
            var result = new List<BluetoothDevice>();
            var search = new BLUETOOTH_DEVICE_SEARCH_PARAMS
            {
                dwSize = Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_SEARCH_PARAMS)),
                fReturnAuthenticated = true,
                fReturnRemembered = true,
                fReturnConnected = true,
                fReturnUnknown = false,
                fIssueInquiry = false,
                cTimeoutMultiplier = 1,
                hRadio = IntPtr.Zero
            };
            var info = new BLUETOOTH_DEVICE_INFO { dwSize = Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO)) };
            IntPtr handle = BluetoothFindFirstDevice(ref search, ref info);
            if (handle == IntPtr.Zero) return result;
            try
            {
                do
                {
                    uint majorClass = info.ulClassofDevice & 0x1F00;
                    if ((info.fAuthenticated || info.fRemembered) && majorClass == 0x0200)
                        result.Add(new BluetoothDevice { Address = info.Address, Name = info.szName ?? "Android", ClassOfDevice = info.ulClassofDevice });
                    info.dwSize = Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO));
                }
                while (BluetoothFindNextDevice(handle, ref info));
            }
            finally { BluetoothFindDeviceClose(handle); }
            result.Sort(delegate(BluetoothDevice left, BluetoothDevice right)
            {
                if (left.Address == preferredAddress) return -1;
                if (right.Address == preferredAddress) return 1;
                return string.Compare(left.Name, right.Name, StringComparison.CurrentCultureIgnoreCase);
            });
            return result;
        }
    }

    internal sealed class BridgeServer : IDisposable
    {
        private const int Port = 51794;
        private readonly Func<string> pairingCode;
        private readonly CommandRouter commands;
        private readonly Action<string, bool> status;
        private readonly HttpListener listener = new HttpListener();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private Thread listenerThread;
        private volatile bool running;

        public BridgeServer(Func<string> pairingCode, CommandRouter commands, Action<string, bool> status)
        {
            this.pairingCode = pairingCode;
            this.commands = commands;
            this.status = status;
            listener.Prefixes.Add("http://127.0.0.1:" + Port + "/");
        }

        public void Start()
        {
            try
            {
                listener.Start();
                running = true;
                listenerThread = new Thread(ListenLoop) { IsBackground = true, Name = "Presenta Bridge HTTP" };
                listenerThread.Start();
                status("Servicio activo · puerto " + Port, true);
            }
            catch (Exception error)
            {
                status("No se pudo iniciar: " + error.Message, false);
            }
        }

        private void ListenLoop()
        {
            while (running)
            {
                try
                {
                    HttpListenerContext context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(delegate { Handle(context); });
                }
                catch (HttpListenerException) { if (!running) return; }
                catch (ObjectDisposedException) { return; }
            }
        }

        private void Handle(HttpListenerContext context)
        {
            try
            {
                string origin = context.Request.Headers["Origin"] ?? "";
                if (IsAllowedOrigin(origin))
                {
                    context.Response.Headers["Access-Control-Allow-Origin"] = origin;
                    context.Response.Headers["Vary"] = "Origin";
                }
                context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Presenta-Code";
                context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
                context.Response.Headers["Cache-Control"] = "no-store";

                if (context.Request.HttpMethod == "OPTIONS")
                {
                    context.Response.StatusCode = IsAllowedOrigin(origin) ? 204 : 403;
                    context.Response.Close();
                    return;
                }

                if (!IsAllowedOrigin(origin))
                {
                    WriteJson(context, 403, "{\"error\":\"origin_not_allowed\"}");
                    return;
                }

                if (context.Request.HttpMethod == "GET" && context.Request.Url.AbsolutePath == "/health")
                {
                    WriteJson(context, 200, "{\"name\":\"Presenta Bridge\",\"version\":\"0.8.2\",\"ready\":true,\"bluetooth\":true}");
                    return;
                }

                if (context.Request.HttpMethod != "POST" || context.Request.Url.AbsolutePath != "/command")
                {
                    WriteJson(context, 404, "{\"error\":\"not_found\"}");
                    return;
                }

                if (!string.Equals(context.Request.Headers["X-Presenta-Code"], pairingCode(), StringComparison.Ordinal))
                {
                    WriteJson(context, 401, "{\"error\":\"invalid_code\"}");
                    return;
                }

                string body;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding)) body = reader.ReadToEnd();
                var command = serializer.Deserialize<Dictionary<string, object>>(body);
                commands.Execute(command);
                status("PWA conectada · última orden " + DateTime.Now.ToString("HH:mm:ss"), true);
                WriteJson(context, 200, "{\"ok\":true}");
            }
            catch (Exception error)
            {
                status("Error de comando: " + error.Message, false);
                try { WriteJson(context, 400, "{\"error\":\"invalid_command\"}"); } catch { }
            }
        }

        private static bool IsAllowedOrigin(string origin)
        {
            return string.IsNullOrEmpty(origin)
                || origin == "https://presenta-remoto.fran-hrdz93.chatgpt.site"
                || origin == "https://guia-presenta.netlify.app"
                || origin == "http://localhost:3000"
                || origin == "http://127.0.0.1:3000";
        }

        private static void WriteJson(HttpListenerContext context, int statusCode, string json)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }

        public void Dispose()
        {
            running = false;
            if (listener.IsListening) listener.Stop();
            listener.Close();
        }
    }

    internal static class Keyboard
    {
        public const byte VK_LEFT = 0x25;
        public const byte VK_RIGHT = 0x27;
        private const byte VK_ESCAPE = 0x1B;
        private const byte VK_F5 = 0x74;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint WM_KEYDOWN = 0x0100;
        private const uint WM_KEYUP = 0x0101;

        private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr window, uint message, IntPtr wordParameter, IntPtr longParameter);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        public static void Send(byte virtualKey)
        {
            bool isSlideShow;
            IntPtr powerPoint = FindPowerPointWindow(out isSlideShow);
            if (powerPoint != IntPtr.Zero && isSlideShow)
            {
                PostMessage(powerPoint, WM_KEYDOWN, new IntPtr(virtualKey), IntPtr.Zero);
                PostMessage(powerPoint, WM_KEYUP, new IntPtr(virtualKey), new IntPtr(unchecked((int)0xC0000001)));
                return;
            }
            SendGlobal(virtualKey);
        }

        public static void ControlPowerPoint(bool start)
        {
            bool isSlideShow;
            IntPtr powerPoint = FindPowerPointWindow(out isSlideShow);
            if (powerPoint == IntPtr.Zero) throw new InvalidOperationException("Abre PowerPoint antes de iniciar la presentación.");
            SetForegroundWindow(powerPoint);
            Thread.Sleep(140);
            SendGlobal(start ? VK_F5 : VK_ESCAPE);
        }

        private static void SendGlobal(byte virtualKey)
        {
            keybd_event(virtualKey, 0, 0, UIntPtr.Zero);
            keybd_event(virtualKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        private static IntPtr FindPowerPointWindow(out bool isSlideShow)
        {
            IntPtr slideShow = IntPtr.Zero;
            IntPtr editor = IntPtr.Zero;
            EnumWindows(delegate(IntPtr window, IntPtr parameter)
            {
                if (!IsWindowVisible(window)) return true;
                uint processId;
                GetWindowThreadProcessId(window, out processId);
                try
                {
                    using (Process process = Process.GetProcessById((int)processId))
                    {
                        if (!string.Equals(process.ProcessName, "POWERPNT", StringComparison.OrdinalIgnoreCase)) return true;
                    }
                    var className = new StringBuilder(128);
                    GetClassName(window, className, className.Capacity);
                    if (string.Equals(className.ToString(), "screenClass", StringComparison.OrdinalIgnoreCase)) slideShow = window;
                    else if (editor == IntPtr.Zero) editor = window;
                }
                catch { }
                return slideShow == IntPtr.Zero;
            }, IntPtr.Zero);
            isSlideShow = slideShow != IntPtr.Zero;
            return isSlideShow ? slideShow : editor;
        }
    }
}
