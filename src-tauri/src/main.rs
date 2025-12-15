// Desktop entry-point delegates to the shared app builder in lib.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dtv::run_desktop();
}
