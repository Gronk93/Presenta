using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
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
            using (var mutex = new Mutex(true, "Local\\PresentaBridge", out created))
            {
                if (!created)
                {
                    MessageBox.Show("Presenta Bridge ya está ejecutándose.", "Presenta Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new BridgeForm());
            }
        }
    }

    internal sealed class BridgeForm : Form
    {
        private readonly OverlayForm overlay;
        private readonly BridgeServer server;
        private readonly NotifyIcon trayIcon;
        private readonly Label statusLabel;
        private readonly Label codeLabel;
        private readonly ComboBox screenPicker;
        private readonly string pairingCode;
        private bool exitRequested;

        public BridgeForm()
        {
            pairingCode = LoadOrCreatePairingCode();
            Text = "Presenta Bridge";
            Icon = SystemIcons.Application;
            BackColor = Color.FromArgb(243, 240, 232);
            ForeColor = Color.FromArgb(23, 28, 37);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
            ClientSize = new Size(470, 330);
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
                Text = "Conecta la PWA con tu pantalla",
                AutoSize = true,
                Location = new Point(25, 55),
                Font = new Font("Segoe UI Semibold", 20f, FontStyle.Bold)
            };

            var codeCaption = new Label
            {
                Text = "CÓDIGO DEL BRIDGE",
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

            var copyButton = MakeButton("Copiar código", new Point(292, 137), new Size(145, 41));
            copyButton.Click += delegate
            {
                Clipboard.SetText(pairingCode);
                statusLabel.Text = "Código copiado";
            };

            var screenCaption = new Label
            {
                Text = "Pantalla donde aparecerá el láser",
                AutoSize = true,
                Location = new Point(29, 205),
                ForeColor = Color.FromArgb(110, 113, 111)
            };

            screenPicker = new ComboBox
            {
                Location = new Point(29, 228),
                Size = new Size(278, 34),
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            PopulateScreens();
            screenPicker.SelectedIndexChanged += delegate
            {
                if (screenPicker.SelectedIndex >= 0) overlay.UseScreen(screenPicker.SelectedIndex);
            };

            var hideButton = MakeButton("Ocultar", new Point(320, 226), new Size(117, 36));
            hideButton.Click += delegate { Hide(); };

            statusLabel = new Label
            {
                Text = "Iniciando servicio local…",
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleLeft,
                Location = new Point(29, 286),
                Size = new Size(408, 22),
                ForeColor = Color.FromArgb(22, 122, 89)
            };

            Controls.AddRange(new Control[] { header, title, codeCaption, codeLabel, copyButton, screenCaption, screenPicker, hideButton, statusLabel });

            overlay = new OverlayForm();
            overlay.UseScreen(0);
            overlay.Show();

            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir Presenta Bridge", null, delegate { ShowWindow(); });
            menu.Items.Add("Copiar código", null, delegate { Clipboard.SetText(pairingCode); });
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

            server = new BridgeServer(pairingCode, overlay, SetBridgeStatus);
            server.Start();
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
            server.Dispose();
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

        private static string LoadOrCreatePairingCode()
        {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Presenta");
            string path = Path.Combine(folder, "bridge-code.txt");
            try
            {
                if (File.Exists(path))
                {
                    string existing = File.ReadAllText(path).Trim();
                    if (existing.Length == 6) return existing;
                }
                Directory.CreateDirectory(folder);
                string created = new Random().Next(100000, 1000000).ToString();
                File.WriteAllText(path, created);
                return created;
            }
            catch
            {
                return new Random().Next(100000, 1000000).ToString();
            }
        }

        private static string FormatCode(string code)
        {
            return code.Substring(0, 3) + "  " + code.Substring(3);
        }
    }

    internal sealed class OverlayForm : Form
    {
        private const int WS_EX_TRANSPARENT = 0x20;
        private const int WS_EX_TOOLWINDOW = 0x80;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private double pointerX = .5;
        private double pointerY = .5;
        private bool laserActive;
        private bool pointerVisible;
        private bool blackoutActive;
        private readonly System.Windows.Forms.Timer pointerIdleTimer;
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
            pointerIdleTimer = new System.Windows.Forms.Timer { Interval = 1800 };
            pointerIdleTimer.Tick += delegate
            {
                pointerIdleTimer.Stop();
                pointerVisible = false;
                Invalidate();
            };
            safetyTimer = new System.Windows.Forms.Timer { Interval = 7000 };
            safetyTimer.Tick += delegate
            {
                safetyTimer.Stop();
                pointerVisible = false;
                laserActive = false;
                blackoutActive = false;
                Invalidate();
            };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

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
                Bounds = screens[index].Bounds;
                Invalidate();
            });
        }

        public void SetPointer(double x, double y)
        {
            pointerX = Math.Max(0, Math.Min(1, x));
            pointerY = Math.Max(0, Math.Min(1, y));
            RunOnUi(delegate
            {
                pointerVisible = laserActive;
                pointerIdleTimer.Stop();
                pointerIdleTimer.Start();
                Invalidate();
            });
        }

        public void SetLaser(bool active)
        {
            laserActive = active;
            RunOnUi(delegate
            {
                if (!active) pointerVisible = false;
                Invalidate();
            });
        }

        public void SetBlackout(bool active)
        {
            blackoutActive = active;
            RunOnUi(Invalidate);
        }

        public void Touch()
        {
            RunOnUi(delegate
            {
                safetyTimer.Stop();
                safetyTimer.Start();
            });
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (blackoutActive)
            {
                e.Graphics.Clear(Color.Black);
                using (var font = new Font("Segoe UI", 13f))
                using (var brush = new SolidBrush(Color.FromArgb(150, 255, 255, 255)))
                {
                    const string text = "Pantalla en pausa";
                    SizeF size = e.Graphics.MeasureString(text, font);
                    e.Graphics.DrawString(text, font, brush, (ClientSize.Width - size.Width) / 2, (ClientSize.Height - size.Height) / 2);
                }
                return;
            }

            e.Graphics.Clear(Color.Fuchsia);
            if (!laserActive || !pointerVisible) return;
            float x = (float)(pointerX * ClientSize.Width);
            float y = (float)(pointerY * ClientSize.Height);
            using (var glow = new SolidBrush(Color.FromArgb(72, 237, 68, 88)))
            using (var middle = new SolidBrush(Color.FromArgb(150, 237, 68, 88)))
            using (var core = new SolidBrush(Color.FromArgb(255, 239, 48, 70)))
            using (var white = new Pen(Color.White, 2.5f))
            {
                e.Graphics.FillEllipse(glow, x - 22, y - 22, 44, 44);
                e.Graphics.FillEllipse(middle, x - 13, y - 13, 26, 26);
                e.Graphics.FillEllipse(core, x - 7, y - 7, 14, 14);
                e.Graphics.DrawEllipse(white, x - 8, y - 8, 16, 16);
            }
        }

        private void RunOnUi(MethodInvoker action)
        {
            if (IsDisposed) return;
            if (InvokeRequired) BeginInvoke(action); else action();
        }
    }

    internal sealed class BridgeServer : IDisposable
    {
        private const int Port = 51794;
        private readonly string pairingCode;
        private readonly OverlayForm overlay;
        private readonly Action<string, bool> status;
        private readonly HttpListener listener = new HttpListener();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private Thread listenerThread;
        private volatile bool running;

        public BridgeServer(string pairingCode, OverlayForm overlay, Action<string, bool> status)
        {
            this.pairingCode = pairingCode;
            this.overlay = overlay;
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
                    WriteJson(context, 200, "{\"name\":\"Presenta Bridge\",\"version\":\"0.3.0\",\"ready\":true}");
                    return;
                }

                if (context.Request.HttpMethod != "POST" || context.Request.Url.AbsolutePath != "/command")
                {
                    WriteJson(context, 404, "{\"error\":\"not_found\"}");
                    return;
                }

                if (context.Request.Headers["X-Presenta-Code"] != pairingCode)
                {
                    WriteJson(context, 401, "{\"error\":\"invalid_code\"}");
                    return;
                }

                string body;
                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding)) body = reader.ReadToEnd();
                var command = serializer.Deserialize<Dictionary<string, object>>(body);
                Execute(command);
                status("PWA conectada · última orden " + DateTime.Now.ToString("HH:mm:ss"), true);
                WriteJson(context, 200, "{\"ok\":true}");
            }
            catch (Exception error)
            {
                status("Error de comando: " + error.Message, false);
                try { WriteJson(context, 400, "{\"error\":\"invalid_command\"}"); } catch { }
            }
        }

        private void Execute(Dictionary<string, object> command)
        {
            overlay.Touch();
            string type = command.ContainsKey("type") ? Convert.ToString(command["type"]) : "";
            if (type == "ping") return;
            if (type == "pointer")
            {
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
                overlay.SetBlackout(Convert.ToBoolean(command["active"]));
                return;
            }
            if (type == "slide")
            {
                int direction = Convert.ToInt32(command["direction"]);
                Keyboard.Send(direction >= 0 ? Keyboard.VK_RIGHT : Keyboard.VK_LEFT);
                return;
            }
            throw new InvalidOperationException("Unknown command");
        }

        private static bool IsAllowedOrigin(string origin)
        {
            return string.IsNullOrEmpty(origin)
                || origin == "https://presenta-remoto.fran-hrdz93.chatgpt.site"
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
        private const uint KEYEVENTF_KEYUP = 0x0002;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

        public static void Send(byte virtualKey)
        {
            keybd_event(virtualKey, 0, 0, UIntPtr.Zero);
            keybd_event(virtualKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }
    }
}
