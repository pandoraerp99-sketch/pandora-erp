/**
 * Tests unitarios de resolveClientIp — extracción confiable de la IP del cliente.
 *
 * Por qué importa: la IP es el `subject` del rate limit de login
 * (POLICY_LOGIN_BY_IP, 5 intentos/min). Si el atacante puede elegir qué IP
 * reportamos, rota el valor y el límite no existe.
 *
 * `x-forwarded-for` es una LISTA y el cliente controla el extremo izquierdo:
 * puede mandar `x-forwarded-for: 1.2.3.4` y el proxy le agrega la real
 * detrás → `1.2.3.4, <real>`. Por eso NO se toma el primero.
 */
import { describe, expect, it } from 'vitest';
import { IP_UNKNOWN_SENTINEL, resolveClientIp } from '@/lib/security/client-ip';

/** Helper: arma un Headers desde un objeto plano. */
function h(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('resolveClientIp', () => {
  describe('x-real-ip tiene prioridad', () => {
    it('usa x-real-ip cuando está presente', () => {
      expect(resolveClientIp(h({ 'x-real-ip': '203.0.113.7' }))).toBe(
        '203.0.113.7'
      );
    });

    it('prefiere x-real-ip por sobre x-forwarded-for', () => {
      // x-real-ip lo setea el proxy con un único valor; XFF es acumulativo
      // y su extremo izquierdo lo controla el cliente.
      const headers = h({
        'x-real-ip': '203.0.113.7',
        'x-forwarded-for': '1.2.3.4, 203.0.113.7',
      });
      expect(resolveClientIp(headers)).toBe('203.0.113.7');
    });
  });

  describe('x-forwarded-for — se toma el ÚLTIMO hop, no el primero', () => {
    it('con un solo valor lo devuelve tal cual', () => {
      expect(resolveClientIp(h({ 'x-forwarded-for': '203.0.113.7' }))).toBe(
        '203.0.113.7'
      );
    });

    it('ANTI-SPOOF: ignora la IP inyectada por el cliente a la izquierda', () => {
      // El atacante manda `x-forwarded-for: 9.9.9.9`. El proxy le agrega
      // la IP real detrás. Tomar el primero le dejaría elegir su bucket
      // de rate limit y rotarlo a voluntad.
      const headers = h({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' });
      expect(resolveClientIp(headers)).toBe('203.0.113.7');
    });

    it('con varios hops toma el último (el que agregó el proxy más cercano)', () => {
      const headers = h({
        'x-forwarded-for': '9.9.9.9, 10.0.0.1, 203.0.113.7',
      });
      expect(resolveClientIp(headers)).toBe('203.0.113.7');
    });

    it('tolera espacios alrededor de las comas', () => {
      expect(
        resolveClientIp(h({ 'x-forwarded-for': '9.9.9.9,   203.0.113.7  ' }))
      ).toBe('203.0.113.7');
    });

    it('ignora entradas vacías al final (coma colgante)', () => {
      expect(
        resolveClientIp(h({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7, ' }))
      ).toBe('203.0.113.7');
    });
  });

  describe('sin headers — degrada a un bucket compartido, no a "sin límite"', () => {
    it('devuelve el centinela cuando no hay ningún header', () => {
      expect(resolveClientIp(h({}))).toBe(IP_UNKNOWN_SENTINEL);
    });

    it('devuelve el centinela si los headers están vacíos', () => {
      expect(
        resolveClientIp(h({ 'x-real-ip': '', 'x-forwarded-for': '  ' }))
      ).toBe(IP_UNKNOWN_SENTINEL);
    });

    it('el centinela NUNCA es string vacío — checkRateLimit tira si lo es', () => {
      // checkRateLimit lanza con subject vacío ("bug de programacion").
      // Si el centinela fuera '', un header faltante = 500 en cada login.
      expect(IP_UNKNOWN_SENTINEL.trim().length).toBeGreaterThan(0);
    });
  });

  describe('normalización', () => {
    it('recorta espacios de x-real-ip', () => {
      expect(resolveClientIp(h({ 'x-real-ip': '  203.0.113.7  ' }))).toBe(
        '203.0.113.7'
      );
    });

    it('IPv6 pasa sin tocar', () => {
      const ip = '2001:db8::1';
      expect(resolveClientIp(h({ 'x-real-ip': ip }))).toBe(ip);
    });
  });
});
