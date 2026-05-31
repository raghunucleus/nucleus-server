import { createHmac } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { InstitutionSetting } from '../../admin/entities/institution-setting.entity';

/**
 * Decoded shape of the QR string. NOT a JWT — deliberately a tiny HMAC-signed
 * code so a future security app can verify it offline with one shared secret
 * and no JWT library. Format: `<VERSION>.<emp_code>.<sig>` where `sig` is the
 * base64url HMAC-SHA256 of `<VERSION>.<emp_code>` keyed by JWT_ID_CARD_SECRET.
 *
 * The signature is what lets a scanner trust "this is a real employee" — a
 * plain emp_code would be trivially forgeable. There is intentionally NO
 * expiry: an employee card stays valid until the employee record is removed.
 */
export const EMPLOYEE_QR_VERSION = 'NCLS-EMP1';

export interface EmployeeIdCardResult {
  employee: {
    emp_display_name: string;
    emp_code: string;
    gender: string;
    // Bare date (YYYY-MM-DD) or null — DOB is optional for employees.
    dob: string | null;
    mobile_number: string;
    country_code: string;
    email: string;
    // Always null for now: employees have no photo-upload path yet. Kept in the
    // shape so a photo can be wired in later without changing the contract; the
    // clients already fall back to an initials avatar when it is null.
    photo_url: string | null;
  };
  designation: { name: string; code: string } | null;
  department: { name: string; code: string } | null;
  institution: {
    name: string;
    short_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    logo_url: string | null;
    affiliation_code: string | null;
    aicte_code: string | null;
    naac_grade: string | null;
    card_footer_note: string | null;
  };
  // Compact HMAC-signed code rendered as the QR. Verifiable by the security app.
  qr_token: string;
  // Employee cards never expire — always null. Present for parity with the
  // student card so the clients can share the same rendering logic.
  valid_until: null;
}

@Injectable()
export class EmployeeIdCardService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(InstitutionSetting)
    private readonly institutionSettings: Repository<InstitutionSetting>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Build the ID card for the signed-in employee. The employee id comes from
   * the controller (JWT), never from the request — an employee only ever gets
   * their own card.
   */
  async getCard(employeeId: number): Promise<EmployeeIdCardResult> {
    // Employee eager-loads department and designation.
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const institution = await this.getInstitution();

    return {
      employee: {
        emp_display_name: employee.emp_display_name,
        emp_code: employee.emp_code,
        gender: employee.gender,
        dob: employee.dob,
        mobile_number: employee.mobile_number,
        country_code: employee.country_code,
        email: employee.email,
        photo_url: null,
      },
      designation: employee.designation
        ? { name: employee.designation.name, code: employee.designation.code }
        : null,
      department: employee.department
        ? { name: employee.department.name, code: employee.department.code }
        : null,
      institution: {
        name: institution.name,
        short_name: institution.short_name,
        address_line1: institution.address_line1,
        address_line2: institution.address_line2,
        city: institution.city,
        state: institution.state,
        pincode: institution.pincode,
        logo_url: institution.logo_url,
        affiliation_code: institution.affiliation_code,
        aicte_code: institution.aicte_code,
        naac_grade: institution.naac_grade,
        card_footer_note: institution.card_footer_note,
      },
      qr_token: this.signQr(employee.emp_code),
      valid_until: null,
    };
  }

  private async getInstitution(): Promise<InstitutionSetting> {
    const existing = await this.institutionSettings.findOne({
      where: { id: 1 },
    });
    if (existing) return existing;
    // Never seeded (fresh DB without the migration seed) — return a safe shell
    // so the card still renders.
    return this.institutionSettings.create({ id: 1, name: 'Institution' });
  }

  /**
   * Produce the QR string: `<VERSION>.<emp_code>.<sig>`. No expiry — the code
   * is stable for the life of the employee record. A scanner recomputes the
   * HMAC over `<VERSION>.<emp_code>` with the same secret to confirm the code
   * was issued by us; the emp_code then identifies the employee.
   */
  private signQr(empCode: string): string {
    const secret = this.config.getOrThrow<string>('JWT_ID_CARD_SECRET');
    const body = `${EMPLOYEE_QR_VERSION}.${empCode}`;
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
}
