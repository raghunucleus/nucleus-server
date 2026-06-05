import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { InstitutionSetting } from '../../admin/entities/institution-setting.entity';
import { SecurityPassResponse } from '../../common/security-pass';
import { SecurityPassService } from '../../security-pass/security-pass.service';

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
  // Single-use, short-lived security pass rendered as the QR. Verified by the
  // security app; rotated by the client on expiry (see ttl_seconds).
  qr_token: string;
  // Seconds the qr_token is valid for — drives the client countdown.
  ttl_seconds: number;
  // ISO timestamp the qr_token expires at.
  expires_at: string;
  // Employee cards never expire — always null. Present for parity with the
  // student card so the clients can share the same rendering logic. (Distinct
  // from the short-lived qr_token, which always expires.)
  valid_until: null;
}

@Injectable()
export class EmployeeIdCardService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(InstitutionSetting)
    private readonly institutionSettings: Repository<InstitutionSetting>,
    private readonly pass: SecurityPassService,
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

    const [institution, pass] = await Promise.all([
      this.getInstitution(),
      this.pass.issue('employee', employee.id, employee.emp_code),
    ]);

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
      qr_token: pass.qr_token,
      ttl_seconds: pass.ttl_seconds,
      expires_at: pass.expires_at,
      valid_until: null,
    };
  }

  /**
   * Issue just a fresh security pass for the signed-in employee. Backs the
   * lightweight `/employee/id-card/pass` endpoint the client polls to rotate
   * the QR without re-fetching the whole card.
   */
  async issuePass(employeeId: number): Promise<SecurityPassResponse> {
    const employee = await this.employees.findOne({
      where: { id: employeeId },
      select: { id: true, emp_code: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.pass.issue('employee', employee.id, employee.emp_code);
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
}
