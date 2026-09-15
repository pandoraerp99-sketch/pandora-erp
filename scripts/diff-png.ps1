# Compara dos capturas del mismo tamaño: cuenta píxeles distintos (tolerancia
# por canal) y da el rectángulo que los contiene. Sirve para probar que un
# cambio NO movió nada en un tema. El recorrido va en C# (GetPixel desde
# PowerShell tarda minutos en una captura entera).
# Uso: powershell -File diff-png.ps1 -A antes.png -B despues.png [-Tol 8]
param(
  [Parameter(Mandatory)] [string] $A,
  [Parameter(Mandatory)] [string] $B,
  [int] $Tol = 8,
  # Franja a comparar (filas). Sirve cuando un cambio esperado corre el resto.
  [int] $Y0 = 0,
  [int] $Y1 = 100000,
  # Columnas: para dejar afuera la barra lateral y el avatar, que están animados.
  [int] $X0 = 0,
  [int] $X1 = 100000
)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class DiffPng {
  public static string Run(string a, string b, int tol, int fy0, int fy1, int fx0, int fx1) {
    using (var ba = new Bitmap(a)) using (var bb = new Bitmap(b)) {
      if (ba.Width != bb.Width || ba.Height != bb.Height)
        return String.Format("TAMAÑO DISTINTO {0}x{1} vs {2}x{3}", ba.Width, ba.Height, bb.Width, bb.Height);
      var r = new Rectangle(0, 0, ba.Width, ba.Height);
      var da = ba.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var db = bb.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      int len = da.Stride * ba.Height;
      var pa = new byte[len]; var pb = new byte[len];
      Marshal.Copy(da.Scan0, pa, 0, len); Marshal.Copy(db.Scan0, pb, 0, len);
      ba.UnlockBits(da); bb.UnlockBits(db);
      long n = 0; int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
      for (int y = Math.Max(0, fy0); y < Math.Min(ba.Height, fy1); y++) for (int x = Math.Max(0, fx0); x < Math.Min(ba.Width, fx1); x++) {
        int i = y * da.Stride + x * 4;
        if (Math.Abs(pa[i] - pb[i]) > tol || Math.Abs(pa[i+1] - pb[i+1]) > tol || Math.Abs(pa[i+2] - pb[i+2]) > tol) {
          n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
      }
      return n == 0 ? String.Format("IGUALES (tol {0})", tol)
                    : String.Format("DISTINTOS: {0} px en x={1}..{2} y={3}..{4} (tol {5})", n, x0, x1, y0, y1, tol);
    }
  }
}
'@
[DiffPng]::Run((Resolve-Path $A).Path, (Resolve-Path $B).Path, $Tol, $Y0, $Y1, $X0, $X1)
